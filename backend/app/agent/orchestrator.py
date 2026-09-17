"""The agent core: one interaction = authorize → reserve → run tools → validate → repair (≤2) → persist → settle.

Three modes:
  guided  — fixed plan (generation)                  run_guided()
  repair  — one tool chosen by code (feedback/checks) run_single()
  free    — chat planner picks tools via function calling (chat.py builds on run_tool())
"""
from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel

from .. import observability as obs
from .. import repo
from ..billing import credits, pricing
from ..catalog import Catalog
from ..config import get_settings
from ..llm.client import LLMUnavailable
from ..schemas.domain import Campaign, ClarityResult, CreditsInfo, MutationResponse, ValidationResult
from . import prompts, registry, validators
from .memory import MemoryBlock
from .registry import AgentCtx, StageEvent, UserCtx
from .tools import edits, generation  # noqa: F401  (register tools)

log = logging.getLogger(__name__)

GUIDED_PLAN = ["rank_publishers", "pick_personas", "write_creatives", "build_config"]
REPAIR_INPUTS = {  # validator repair_tool → how to build its input from the failing check
    "regenerate_creative": lambda v: {"persona_id": v.target.get("persona_id"), "instruction": v.message},
    "build_config": lambda v: {"instruction": v.message},
    "rank_publishers": lambda v: {"focus_publisher_id": v.target.get("publisher_id"), "instruction": v.message},
    "pick_personas": lambda v: {"exclude_persona_ids": [v.target["persona_id"]] if v.target.get("persona_id") else [], "instruction": v.message},
    "set_budget": lambda v: {},
    "drop_publisher": lambda v: {"publisher_id": v.target.get("publisher_id"), "reason": v.message},
}


class RunError(Exception):
    def __init__(self, code: str, message: str, status: int = 500, payload: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.payload = code, message, status, payload


@dataclass
class Interaction:
    id: UUID
    thread_id: UUID
    kind: str
    mode: str
    action: str            # billing action key ('' when free)
    started: float


async def open_interaction(conn, user: UserCtx, thread_id: UUID, kind: str, mode: str, action: str, input_: dict, campaign_id: UUID | None) -> Interaction:
    iid = await repo.open_interaction(conn, thread_id, user.id, kind, mode, input_, prompts.versions())
    try:
        await credits.reserve(conn, user.id, action, interaction_id=iid, campaign_id=campaign_id)
    except credits.InsufficientCredits as e:
        await repo.close_interaction(conn, iid, status="rejected", plan=[], usage={}, credits_base=0, credits_usage=0, duration_ms=0)
        raise RunError("insufficient_credits", f"You have {e.balance} credits; this needs at least {e.needed}.", 402) from e
    return Interaction(iid, thread_id, kind, mode, action, time.perf_counter())


def apply_tool_output(c: Campaign, tool_name: str, out: BaseModel) -> None:
    """Merge a tool's output into the campaign. Mutating tools that edit ctx.campaign in place return CampaignOut."""
    if tool_name == "rank_publishers":
        c.publishers, c.excluded = out.publishers, out.excluded  # type: ignore[attr-defined]
    elif tool_name == "pick_personas":
        c.personas, c.skipped_personas = out.personas, out.skipped  # type: ignore[attr-defined]
    elif tool_name == "write_creatives":
        c.creatives = out.creatives  # type: ignore[attr-defined]
    elif tool_name == "build_config":
        c.config = out.config  # type: ignore[attr-defined]


async def run_tool(ctx: AgentCtx, name: str, inp: dict) -> BaseModel:
    tool_cls = registry.get(name)
    tool = tool_cls()
    parsed = tool_cls.Input.model_validate(inp)
    with obs.tool(f"tool.{name}", input=parsed, metadata={"mutates": tool_cls.mutates, "cost_base": tool_cls.cost.base, "cost_usage": tool_cls.cost.usage}) as t:
        out = await tool.run(ctx, parsed)
        if ctx.campaign is not None:
            apply_tool_output(ctx.campaign, name, out)
        obs.finish(t, output=_tool_summary(name, out))
    return out


def _tool_summary(name: str, out: BaseModel) -> dict:
    """Compact output for the trace UI (full objects are persisted in Postgres anyway)."""
    d = out.model_dump(mode="json")
    if name == "rank_publishers":
        return {"recommended": [(p["id"], p["score"], p["llm_delta"]) for p in d["publishers"]], "excluded": [(e["id"], e["score"]) for e in d["excluded"]]}
    if name == "pick_personas":
        return {"personas": [(p["id"], p["fit"]) for p in d["personas"]], "skipped": [s["id"] for s in d["skipped"]]}
    if name == "write_creatives":
        return {"creatives": [(c["persona_id"], c["headline"]) for c in d["creatives"]]}
    if name == "build_config":
        k = d["config"]
        return {"objective": k["objective"], "bid": k["bid"]["strategy"], "budget": k["budget"], "allocation": k["allocation"]}
    if name == "score_clarity":
        return {"score": d["score"], "label": d["label"], "questions": len(d["questions"]), "summary": d["summary"]}
    return d


async def validate_and_repair(ctx: AgentCtx, plan: list[dict]) -> list[ValidationResult]:
    """Run validators; for each failing check whose repair tool is safe to call automatically, re-run it once. Bounded by settings.max_repairs."""
    assert ctx.campaign
    with obs.guardrail("validators.run_all", metadata={"max_repairs": get_settings().max_repairs}) as g:
        results = validators.run_all(ctx.campaign, ctx.catalog, ctx.memory)
        before = [r.check for r in results if not r.passed]
        repairs = 0
        seen: set[str] = set()
        for v in [r for r in results if not r.passed and r.severity == "error"]:
            if repairs >= get_settings().max_repairs or v.check in seen or v.repair_tool not in REPAIR_INPUTS:
                continue
            seen.add(v.check)
            try:
                await ctx.stage("Running checks", "run", f"repairing {v.check} via {v.repair_tool}")
                await run_tool(ctx, v.repair_tool, REPAIR_INPUTS[v.repair_tool](v))
                plan.append({"tool": v.repair_tool, "repair_for": v.check})
                repairs += 1
            except Exception as e:  # a failed repair must never sink the run
                log.warning("repair %s failed: %s", v.repair_tool, e)
            results = validators.run_all(ctx.campaign, ctx.catalog, ctx.memory)
        after = [r.check for r in results if not r.passed]
        obs.finish(g, output={"failing_before": before, "repairs": repairs, "failing_after": after, "passing": f"{sum(r.passed for r in results)}/{len(results)}"},
                   level="WARNING" if after else "DEFAULT")
    return results


def status_for(results: list[ValidationResult], current: str) -> str:
    if current == "ready":
        return current
    return "needs_review" if any(not r.passed and r.severity == "error" for r in results) else "draft"


async def finish(conn, ctx: AgentCtx, it: Interaction, plan: list[dict], note: str, *, snapshot: bool = True, repair: bool = False) -> MutationResponse:
    """Validate (+repair when asked), bump version, persist, record checks, settle credits, close the interaction."""
    c = ctx.campaign
    assert c
    results = await validate_and_repair(ctx, plan) if repair else validators.run_all(c, ctx.catalog, ctx.memory)
    c.status = status_for(results, c.status)
    if snapshot:
        c.version += 1
    c = await repo.save_campaign(conn, c)
    ctx.campaign = c
    if snapshot:
        await repo.snapshot_version(conn, c, it.id, note)
    await repo.save_validation(conn, it.id, c.id, results)
    info = await credits.settle(conn, ctx.user.id, it.action, ctx.usage, interaction_id=it.id, campaign_id=c.id)
    await repo.close_interaction(conn, it.id, status="done", plan=plan, usage=ctx.usage.to_json(), credits_base=info.base, credits_usage=info.usage,
                                 duration_ms=int((time.perf_counter() - it.started) * 1000))
    await ctx.stage("Running checks", "done", f"{sum(r.passed for r in results)}/{len(results)} passing")
    return MutationResponse(campaign=c, validation=results, credits=info)


async def fail(conn, ctx: AgentCtx, it: Interaction, err: Exception) -> None:
    await credits.refund(conn, ctx.user.id, it.action, interaction_id=it.id, campaign_id=ctx.campaign.id if ctx.campaign else None)
    await repo.close_interaction(conn, it.id, status="failed", plan=[], usage=ctx.usage.to_json(), credits_base=0, credits_usage=0,
                                 duration_ms=int((time.perf_counter() - it.started) * 1000))
    if ctx.campaign and ctx.campaign.status == "generating":
        ctx.campaign.status = "failed"
        await repo.save_campaign(conn, ctx.campaign)
    log.error("interaction %s failed: %s", it.id, err)


# ============================================================================ guided (generation)
async def run_guided(conn, user: UserCtx, catalog: Catalog, memory: MemoryBlock, *, brief: str, answers: list[str],
                     parent_campaign_id: UUID | None, emit: Callable[[StageEvent], Awaitable[None] | None] | None) -> MutationResponse:
    """Full generation. Clarity first (free); if vague and unanswered raise 409 with questions; else reserve and run the plan."""
    thread_id = await repo.create_thread(conn, user.id)  # the thread is the trace session; created first so the whole run shares it
    ctx = AgentCtx(user=user, thread_id=thread_id, interaction_id=None, catalog=catalog, memory=memory, conn=conn, emit=emit)
    with obs.agent("agent.generate_campaign", user_id=str(user.id), session_id=str(thread_id), tags=["guided"], input={"brief": brief, "answers": answers},
                   metadata={"memory": memory.render(), "thread_id": str(thread_id)}) as root:
        return await _run_guided(conn, user, catalog, memory, ctx, root, thread_id, brief=brief, answers=answers, parent_campaign_id=parent_campaign_id)


async def _run_guided(conn, user, catalog, memory, ctx: AgentCtx, root, thread_id: UUID, *, brief: str, answers: list[str], parent_campaign_id: UUID | None) -> MutationResponse:
    await ctx.stage("Parsing brief", "run")
    clarity: ClarityResult = await run_tool(ctx, "score_clarity", {"brief": brief, "answers": answers})  # type: ignore[assignment]
    if clarity.score < 60:
        obs.finish_trace(root, output={"outcome": "clarity_too_low", "score": clarity.score, "questions": [q.q for q in clarity.questions]})
        await conn.execute("delete from threads where id=$1", thread_id)  # nothing was generated; don't keep an orphan thread
        raise RunError("clarity_too_low", "The brief needs more detail before generating.", 409, payload=clarity.model_dump(mode="json"))
    name = _name_for(brief, clarity)
    campaign = await repo.create_campaign(conn, user_id=user.id, thread_id=thread_id, name=name, brief=brief, clarity=clarity, parsed=clarity.parsed_brief,
                                          parent_campaign_id=parent_campaign_id)
    await repo.link_thread(conn, thread_id, campaign.id)
    it = await open_interaction(conn, user, thread_id, "generate", "guided", "generate_campaign", {"brief": brief, "answers": answers}, campaign.id)
    ctx.thread_id, ctx.interaction_id, ctx.campaign = thread_id, it.id, campaign
    if root is not None:
        root.update(metadata={"interaction_id": str(it.id), "campaign_id": str(campaign.id)})
    plan: list[dict] = [{"tool": "score_clarity"}]
    try:
        stages = {"rank_publishers": "Scoring 20 publishers", "pick_personas": "Selecting personas", "write_creatives": "Writing creative", "build_config": "Assembling config"}
        for tool_name in GUIDED_PLAN:
            await ctx.stage(stages[tool_name], "run")
            await run_tool(ctx, tool_name, {})
            plan.append({"tool": tool_name})
        await ctx.stage("Running checks", "run")
        ctx.campaign.status = "draft"
        ctx.campaign.version = 0  # finish() bumps to 1
        resp = await finish(conn, ctx, it, plan, "Generated", repair=True)
        obs.finish_trace(root, output=_trace_output(resp, plan), metadata={"usage": ctx.usage.to_json()})
        return resp
    except LLMUnavailable as e:
        await fail(conn, ctx, it, e)
        obs.finish_trace(root, output={"outcome": "llm_unavailable", "error": str(e)[:200]})
        raise RunError("llm_unavailable", "The model is busy — nothing was charged. Try again.", 502) from e
    except Exception as e:
        await fail(conn, ctx, it, e)
        obs.finish_trace(root, output={"outcome": "failed", "error": str(e)[:200]})
        raise


def _trace_output(resp: MutationResponse, plan: list[dict]) -> dict:
    c = resp.campaign
    return {"campaign_id": str(c.id), "name": c.name, "status": c.status, "version": c.version, "plan": plan,
            "publishers": [(p.id, p.score) for p in c.publishers], "personas": [(p.id, p.fit) for p in c.personas],
            "checks": f"{sum(v.passed for v in resp.validation)}/{len(resp.validation)}", "credits": resp.credits.model_dump()}


def _name_for(brief: str, clarity: ClarityResult) -> str:
    p = clarity.parsed_brief.product.strip()
    if p:
        return (p[0].upper() + p[1:])[:60]
    return (brief[:42] + "…") if len(brief) > 42 else brief


# ============================================================================ single tool (edits, regenerate, feedback repair)
async def run_single(conn, user: UserCtx, catalog: Catalog, memory: MemoryBlock, campaign: Campaign, *, tool_name: str, inp: dict, kind: str,
                     action: str, note: str, mode: str = "repair") -> tuple[MutationResponse, UUID]:
    tool_cls = registry.get(tool_name)
    if tool_cls.cost.base and not action:
        action = tool_name
    thread_id = campaign.thread_id or await repo.create_thread(conn, user.id, campaign.id)
    it = await open_interaction(conn, user, thread_id, kind, mode, action, {"tool": tool_name, "input": inp}, campaign.id)
    ctx = AgentCtx(user=user, thread_id=thread_id, interaction_id=it.id, catalog=catalog, memory=memory, conn=conn, campaign=campaign)
    with obs.agent(f"agent.{kind}", user_id=str(user.id), session_id=str(thread_id), tags=[mode, kind], input={"tool": tool_name, "input": inp},
                   metadata={"interaction_id": str(it.id), "campaign_id": str(campaign.id), "version_before": campaign.version}) as root:
        try:
            out = await run_tool(ctx, tool_name, inp)
            if getattr(out, "ok", True) is False:
                raise RunError("invalid_state", getattr(out, "note", "cannot apply"), 409)
            resp = await finish(conn, ctx, it, [{"tool": tool_name}], note, snapshot=tool_cls.mutates)
            obs.finish_trace(root, output=_trace_output(resp, [{"tool": tool_name}]), metadata={"usage": ctx.usage.to_json()})
            return resp, it.id
        except RunError as e:
            await fail(conn, ctx, it, RuntimeError("rejected"))
            obs.finish_trace(root, output={"outcome": e.code, "message": e.message})
            raise
        except LLMUnavailable as e:
            await fail(conn, ctx, it, e)
            obs.finish_trace(root, output={"outcome": "llm_unavailable"})
            raise RunError("llm_unavailable", "The model is busy — nothing was charged. Try again.", 502) from e


def credits_info_free(balance: int) -> CreditsInfo:
    return CreditsInfo(charged=0, base=0, usage=0, balance=balance)


ESTIMATE = pricing.estimate
