"""Free mode: the planner model picks tools via function calling. One turn = one interaction.

Billing: the turn is charged as `chat_llm_edit` only if an LLM-backed tool ran (generate is charged
as its own action inside run_guided). Deterministic-only turns are free.
"""
from __future__ import annotations

import json
import logging
import time
from uuid import UUID

from .. import observability as obs
from .. import repo
from ..billing import credits
from ..catalog import Catalog
from ..config import get_settings
from ..llm.client import LLMUnavailable, client, resolve_model
from ..llm.usage import CallUsage, Usage
from ..schemas.domain import Campaign, MutationResponse
from . import orchestrator, prompts, registry, summarize, validators
from .memory import MemoryBlock, extract_candidates
from .registry import AgentCtx, UserCtx

log = logging.getLogger(__name__)

LLM_TOOLS = {"rank_publishers", "pick_personas", "write_creatives", "build_config", "regenerate_creative", "generate_campaign"}
CHAT_HIDDEN = {"set_config", "add_persona", "prescore_publishers", "write_creatives"}


def _generate_schema() -> dict:
    return {"type": "function", "function": {"name": "generate_campaign", "description": "Build a full campaign from a brief (and answers to clarifying questions). Costs ~12 credits.",
                                             "parameters": {"type": "object", "properties": {"brief": {"type": "string"}, "answers": {"type": "array", "items": {"type": "string"}}},
                                                            "required": ["brief"]}}}


def tool_schemas() -> list[dict]:
    out = [t.openai_schema() for n, t in registry.all_tools().items() if t.chat_exposed and n not in CHAT_HIDDEN]
    out.append(_generate_schema())
    return out


async def turn(conn, user: UserCtx, catalog: Catalog, *, thread_id: UUID | None, campaign_id: UUID | None, message: str) -> dict:
    s = get_settings()
    memory = await repo.load_memory(conn, user.id)
    campaign = await repo.get_campaign(conn, campaign_id, user.id) if campaign_id else None
    if thread_id is None:
        thread_id = campaign.thread_id if campaign and campaign.thread_id else await repo.create_thread(conn, user.id, campaign.id if campaign else None)
    elif await repo.thread_owner(conn, thread_id) != user.id:
        raise orchestrator.RunError("not_found", "thread not found", 404)
    if campaign is None:
        cid = await conn.fetchval("select campaign_id from threads where id=$1", thread_id)
        campaign = await repo.get_campaign(conn, cid, user.id) if cid else None

    history = await repo.list_chat_messages(conn, thread_id, user.id, limit=20)
    await repo.add_chat_message(conn, thread_id, user.id, "user", {"text": message})
    it = await orchestrator.open_interaction(conn, user, thread_id, "chat", "free", "", {"message": message}, campaign.id if campaign else None)
    ctx = AgentCtx(user=user, thread_id=thread_id, interaction_id=it.id, catalog=catalog, memory=memory, conn=conn, campaign=campaign)

    system = prompts.load("chat_system").render(memory=memory.render(ctx.publisher_names()), campaign_summary=summarize.short(campaign, catalog), first_name=(user.name or "there").split(" ")[0])
    messages: list[dict] = [{"role": "system", "content": system}]
    for m in history:
        if m["role"] in ("user", "assistant") and m["content"].get("text"):
            messages.append({"role": m["role"], "content": m["content"]["text"]})
    messages.append({"role": "user", "content": message})

    cards: list[dict] = []
    plan: list[dict] = []
    mutated = False
    llm_tool_ran = False
    reply = ""
    model = resolve_model("strong")
    root_cm = obs.agent("agent.chat_turn", user_id=str(user.id), session_id=str(thread_id), tags=["free", "chat"], input={"message": message},
                        metadata={"interaction_id": str(it.id), "campaign_id": str(campaign.id) if campaign else None, "prompt_version": prompts.load("chat_system").version})
    root = root_cm.__enter__()
    try:
        for step in range(s.chat_max_tool_calls + 1):
            t0 = time.perf_counter()
            with obs.generation("llm.chat_planner", model=model, input=messages[-6:], metadata={"step": step, "tools": len(tool_schemas())}, model_parameters={"temperature": 0.3}) as gen:
                resp = await client().chat.completions.create(model=model, messages=messages, tools=tool_schemas(), tool_choice="auto", temperature=0.3)
                u = resp.usage
                ctx.usage.add(CallUsage(tool="chat_planner", model=model, prompt_tokens=u.prompt_tokens, completion_tokens=u.completion_tokens, total_tokens=u.total_tokens,
                                        duration_ms=int((time.perf_counter() - t0) * 1000)))
                msg = resp.choices[0].message
                obs.finish(gen, output={"content": msg.content, "tool_calls": [{"name": tc.function.name, "args": tc.function.arguments} for tc in (msg.tool_calls or [])]},
                           usage_details={"input": u.prompt_tokens, "output": u.completion_tokens, "total": u.total_tokens})
            if not msg.tool_calls:
                reply = (msg.content or "").strip()
                break
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result, card = await _dispatch(conn, ctx, name, args)
                plan.append({"tool": name, "args": args})
                if card:
                    cards.append(card)
                if name in LLM_TOOLS and name != "generate_campaign":
                    llm_tool_ran = True
                if name != "generate_campaign" and registry.all_tools().get(name) and registry.get(name).mutates:
                    mutated = True
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)[:4000]})
        else:
            reply = "I stopped after several steps — here's where we are."
    except LLMUnavailable as e:
        await orchestrator.fail(conn, ctx, it, e)
        obs.finish_trace(root, output={"outcome": "llm_unavailable"})
        root_cm.__exit__(None, None, None)
        raise orchestrator.RunError("llm_unavailable", "The model is busy — nothing was charged.", 502) from e
    except BaseException:
        root_cm.__exit__(None, None, None)
        raise

    # regex memory extraction as a safety net when the planner didn't call the memory tools itself
    if not any(p["tool"] in ("save_preference", "remember_fact") for p in plan):
        for cand in extract_candidates(message, ctx.publisher_names()):
            if cand["kind"] == "fact":
                await repo.add_fact(conn, user.id, cand["text"], "chat", ctx.campaign.id if ctx.campaign else None, it.id)
                cards.append({"type": "memory_saved", "kind": "fact", "text": cand["text"]})
            else:
                if isinstance(cand["value"], list):
                    await repo.merge_list_preference(conn, user.id, cand["key"], cand["value"], "chat", it.id)
                else:
                    await repo.set_preference(conn, user.id, cand["key"], cand["value"], "chat", it.id)
                cards.append({"type": "memory_saved", "kind": "preference", "key": cand["key"], "value": cand["value"]})

    # persist campaign mutations from free-mode tools (generate persists itself)
    validation = []
    if ctx.campaign and mutated:
        note = ", ".join(p["tool"] for p in plan if p["tool"] not in ("get_campaign", "export_brief", "save_preference", "remember_fact"))
        ctx.campaign.version += 1
        validation = validators.run_all(ctx.campaign, catalog, ctx.memory)
        ctx.campaign.status = orchestrator.status_for(validation, ctx.campaign.status)
        ctx.campaign = await repo.save_campaign(conn, ctx.campaign)
        await repo.snapshot_version(conn, ctx.campaign, it.id, f"chat: {note}")
        await repo.save_validation(conn, it.id, ctx.campaign.id, validation)
    elif ctx.campaign:
        validation = validators.run_all(ctx.campaign, catalog, ctx.memory)

    action = "chat_llm_edit" if llm_tool_ran else ""
    if action:
        try:
            await credits.reserve(conn, user.id, action, interaction_id=it.id, campaign_id=ctx.campaign.id if ctx.campaign else None)
        except credits.InsufficientCredits:
            action = ""  # work already done; don't fail the turn, just don't charge base
    # Planner-only turns (questions, deterministic edits) are free: usage is recorded on the interaction but not charged.
    billable = ctx.usage if llm_tool_ran else Usage()
    info = await credits.settle(conn, user.id, action, billable, interaction_id=it.id, campaign_id=ctx.campaign.id if ctx.campaign else None)
    await repo.close_interaction(conn, it.id, status="done", plan=plan, usage=ctx.usage.to_json(), credits_base=info.base, credits_usage=info.usage,
                                 duration_ms=int((time.perf_counter() - it.started) * 1000))
    if ctx.campaign and not any(c.get("type") == "campaign_summary" for c in cards) and mutated:
        cards.append(campaign_card(ctx.campaign, catalog, validation))
    await repo.add_chat_message(conn, thread_id, user.id, "assistant", {"text": reply}, cards, it.id)
    obs.finish_trace(root, output={"reply": reply, "plan": plan, "cards": [c.get("type") for c in cards], "credits": info.model_dump()}, metadata={"usage": ctx.usage.to_json()})
    root_cm.__exit__(None, None, None)
    return {"thread_id": str(thread_id), "campaign_id": str(ctx.campaign.id) if ctx.campaign else None, "reply": reply, "cards": cards,
            "credits": info.model_dump(), "validation": [v.model_dump() for v in validation]}


def campaign_card(c: Campaign, catalog: Catalog, validation) -> dict:
    return {"type": "campaign_summary", "campaign_id": str(c.id), "name": c.name, "version": c.version, "clarity": c.clarity.score, "status": c.status,
            "publishers": [{"id": p.id, "name": catalog.publisher(p.id).name, "score": p.score} for p in c.publishers[:5]],
            "creatives": len(c.creatives), "budget_total": c.config.budget.total_usd if c.config else None, "bid_strategy": c.config.bid.strategy if c.config else None,
            "checks_passing": sum(v.passed for v in validation), "checks_total": len(validation)}


async def _dispatch(conn, ctx: AgentCtx, name: str, args: dict) -> tuple[dict, dict | None]:
    """Run one tool call from the planner; return (result for the model, card for the UI)."""
    catalog = ctx.catalog
    if name == "generate_campaign":
        brief = (args.get("brief") or "").strip()
        answers = [str(a) for a in (args.get("answers") or [])]
        if not brief:
            return {"error": "brief required"}, None
        try:
            resp: MutationResponse = await orchestrator.run_guided(conn, ctx.user, catalog, ctx.memory, brief=brief, answers=answers, parent_campaign_id=None, emit=None)
        except orchestrator.RunError as e:
            if e.code == "clarity_too_low" and e.payload:
                return {"clarity_too_low": True, "score": e.payload["score"], "questions": e.payload["questions"]}, {"type": "questions", "score": e.payload["score"], "questions": e.payload["questions"]}
            return {"error": e.code, "message": e.message}, {"type": "error", "message": e.message}
        ctx.campaign = resp.campaign
        await repo.link_thread(conn, ctx.thread_id, resp.campaign.id)  # this chat thread now belongs to the campaign
        return {"campaign_id": str(resp.campaign.id), "summary": summarize.short(resp.campaign, catalog), "credits_charged": resp.credits.charged}, campaign_card(resp.campaign, catalog, resp.validation)
    if name == "score_clarity":
        out = await orchestrator.run_tool(ctx, name, args)
        d = out.model_dump(mode="json")
        card = {"type": "questions", "score": d["score"], "questions": d["questions"]} if d["questions"] else None
        return {k: d[k] for k in ("score", "label", "summary", "questions")}, card
    if name not in registry.all_tools():
        return {"error": f"unknown tool {name}"}, None
    tool = registry.get(name)
    if ctx.campaign is None and name not in ("save_preference", "remember_fact"):
        return {"error": "no campaign in this thread yet — build one first"}, None
    if tool.cost.base:
        try:
            await credits.reserve(conn, ctx.user.id, name, interaction_id=ctx.interaction_id, campaign_id=ctx.campaign.id if ctx.campaign else None)
        except credits.InsufficientCredits as e:
            return {"error": "insufficient_credits", "balance": e.balance, "needed": e.needed}, {"type": "error", "message": f"Not enough credits ({e.balance}) for {name} (needs {e.needed})."}
    out = await orchestrator.run_tool(ctx, name, args)
    d = out.model_dump(mode="json")
    card = None
    if name == "regenerate_creative" and ctx.campaign:
        cr = next((x for x in ctx.campaign.creatives if x.persona_id == args.get("persona_id")), None)
        if cr:
            card = {"type": "creative", "persona_id": cr.persona_id, "persona": catalog.persona(cr.persona_id).name, "headline": cr.headline, "body": cr.body, "cta": cr.cta}
    elif name == "export_brief":
        card = {"type": "export_link", "url": d["url"], "campaign_id": str(ctx.campaign.id)}
    elif name in ("save_preference", "remember_fact"):
        card = {"type": "memory_saved", "kind": "preference" if name == "save_preference" else "fact", **{k: v for k, v in args.items()}}
    elif name == "get_campaign":
        return {"summary": d["summary"]}, None
    return d, card
