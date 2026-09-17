"""Campaign endpoints: clarity, generate (SSE or JSON), read/list/delete, PATCH ops, regenerate, versions, compare."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .. import db, repo
from ..agent import orchestrator, registry
from ..agent.memory import MemoryBlock
from ..agent.registry import StageEvent, UserCtx
from ..agent.tools.generation import ClarityIn
from ..auth import get_current_user
from ..billing import credits, pricing
from ..catalog import Catalog, load_catalog
from ..schemas.domain import Allocation, Campaign, ClarityResult, MutationResponse, ValidationResult
from ..agent import validators
from .common import handle_run_error, rate_limit

router = APIRouter(prefix="/api", tags=["campaigns"])


class ClarityBody(BaseModel):
    brief: str = Field(min_length=3, max_length=2000)
    answers: list[str] = Field(default_factory=list, max_length=3)

    def clean_answers(self) -> list[str]:
        """Blank answers never count as answers (the UI requires every question to be answered)."""
        return [a.strip() for a in self.answers if a and a.strip()]


@router.post("/clarity", response_model=ClarityResult)
async def clarity(body: ClarityBody, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        memory = await repo.load_memory(conn, user.id)
    ctx = registry.AgentCtx(user=user, thread_id=None, interaction_id=None, catalog=catalog, memory=memory)
    return await registry.get("score_clarity")().run(ctx, ClarityIn(brief=body.brief.strip(), answers=body.clean_answers()))


class GenerateBody(ClarityBody):
    parent_campaign_id: UUID | None = None


@router.post("/campaigns")
async def generate(body: GenerateBody, request: Request, user: UserCtx = Depends(get_current_user)):
    """Generate a campaign. With `Accept: text/event-stream` the response streams stage events then a final `done` event."""
    rate_limit(user.id, "generate")
    catalog = load_catalog()
    wants_stream = "text/event-stream" in request.headers.get("accept", "")

    async def run(emit):
        async with db.connection() as conn:
            memory = await repo.load_memory(conn, user.id)
            return await orchestrator.run_guided(conn, user, catalog, memory, brief=body.brief.strip(), answers=body.clean_answers(),
                                                 parent_campaign_id=body.parent_campaign_id, emit=emit)

    if not wants_stream:
        try:
            resp = await run(None)
        except orchestrator.RunError as e:
            raise handle_run_error(e)
        return resp

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def emit(ev: StageEvent) -> None:
        await queue.put({"event": "stage", "data": json.dumps({"stage": ev.stage, "status": ev.status, "detail": ev.detail, "ms": ev.ms})})

    async def worker() -> None:
        try:
            resp = await run(emit)
            await queue.put({"event": "done", "data": resp.model_dump_json()})
        except orchestrator.RunError as e:
            await queue.put({"event": "error", "data": json.dumps({"code": e.code, "message": e.message, "status": e.status, "payload": e.payload})})
        except Exception as e:  # noqa: BLE001
            await queue.put({"event": "error", "data": json.dumps({"code": "internal", "message": str(e)[:300], "status": 500})})
        finally:
            await queue.put(None)

    async def stream():
        task = asyncio.create_task(worker())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()

    return EventSourceResponse(stream(), ping=15)


# ----------------------------------------------------------------------------- read
def _with_validation(c: Campaign, catalog: Catalog, memory: MemoryBlock, balance: int) -> MutationResponse:
    return MutationResponse(campaign=c, validation=validators.run_all(c, catalog, memory), credits=orchestrator.credits_info_free(balance))


@router.get("/campaigns")
async def list_campaigns(user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        memory = await repo.load_memory(conn, user.id)
        items = await repo.list_campaigns(conn, user.id)
    out = []
    for c in items:
        v = validators.run_all(c, catalog, memory)
        out.append({**c.model_dump(mode="json", include={"id", "name", "brief", "status", "version", "created_at", "updated_at", "parent_campaign_id"}),
                    "clarity_score": c.clarity.score, "top_publisher": c.publishers[0].model_dump() if c.publishers else None,
                    "budget_total": c.config.budget.total_usd if c.config else None, "checks_passing": sum(r.passed for r in v), "checks_total": len(v),
                    "creatives": len(c.creatives)})
    return out


async def _load(conn, campaign_id: UUID, user: UserCtx) -> Campaign:
    c = await repo.get_campaign(conn, campaign_id, user.id)
    if not c:
        raise HTTPException(404, "campaign not found")
    return c


@router.get("/campaigns/{campaign_id}", response_model=MutationResponse)
async def get_campaign(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        c, bal = await repo.get_campaign_with_balance(conn, campaign_id, user.id)
        if not c:
            raise HTTPException(404, "campaign not found")
        memory = await repo.load_memory(conn, user.id)
    return _with_validation(c, load_catalog(), memory, bal)


@router.get("/campaigns/{campaign_id}/activity")
async def campaign_activity(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        await _load(conn, campaign_id, user)
        rows = await repo.activity(conn, campaign_id, user.id)
        fb = await repo.list_feedback(conn, campaign_id, user.id)
    return {"interactions": rows, "feedback": fb}


@router.get("/campaigns/{campaign_id}/versions")
async def versions(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        await _load(conn, campaign_id, user)
        return await repo.list_versions(conn, campaign_id)


@router.delete("/campaigns/{campaign_id}", status_code=204)
async def delete(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.tx() as conn:
        if not await repo.delete_campaign(conn, campaign_id, user.id):
            raise HTTPException(404, "campaign not found")


# ----------------------------------------------------------------------------- PATCH ops
class PatchBody(BaseModel):
    op: Literal["drop_publisher", "update_creative", "set_config", "set_budget", "set_status", "add_persona", "restore_version"]
    publisher_id: str | None = None
    reason: str | None = None
    persona_id: str | None = None
    headline: str | None = None
    body: str | None = None
    cta: str | None = None
    total_usd: int | None = None
    daily_usd: int | None = None
    status: Literal["draft", "ready"] | None = None
    version: int | None = None
    config: dict[str, Any] | None = None


@router.patch("/campaigns/{campaign_id}", response_model=MutationResponse)
async def patch(campaign_id: UUID, body: PatchBody, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        c = await _load(conn, campaign_id, user)
        memory = await repo.load_memory(conn, user.id)
        try:
            if body.op == "set_status":
                v = validators.run_all(c, catalog, memory)
                if body.status == "ready" and any(not r.passed and r.severity == "error" for r in v):
                    raise HTTPException(409, "fix failing checks before marking ready")
                c.status = body.status or "draft"
                c = await repo.save_campaign(conn, c)
                return _with_validation(c, catalog, memory, await credits.balance(conn, user.id))
            if body.op == "restore_version":
                target = body.version if body.version is not None else c.version - 1
                snap = await repo.get_version_snapshot(conn, c.id, target)
                if not snap:
                    raise HTTPException(404, f"version {target} not found")
                c = c.model_copy(update=_snap_fields(snap))
                resp, _ = await orchestrator.run_single(conn, user, catalog, memory, c, tool_name="set_config", inp={}, kind="edit", action="",
                                                        note=f"Restored version {target}", mode="none")
                return resp
            tool, inp, note = {
                "drop_publisher": ("drop_publisher", {"publisher_id": body.publisher_id, "reason": body.reason},
                                   f"Dropped {catalog.publisher(body.publisher_id).name if body.publisher_id and catalog.has_publisher(body.publisher_id) else body.publisher_id}"),
                "update_creative": ("update_creative", {"persona_id": body.persona_id, "headline": body.headline, "body": body.body, "cta": body.cta}, "Edited creative"),
                "set_budget": ("set_budget", {"total_usd": body.total_usd, "daily_usd": body.daily_usd}, "Budget changed"),
                "add_persona": ("add_persona", {"persona_id": body.persona_id},
                                f"Added persona {catalog.persona(body.persona_id).name if body.persona_id and catalog.has_persona(body.persona_id) else body.persona_id}"),
                "set_config": ("set_config", _config_input(body.config or {}), "Config saved"),
            }[body.op]
            resp, _ = await orchestrator.run_single(conn, user, catalog, memory, c, tool_name=tool, inp=inp, kind="edit", action="", note=note, mode="none")
            return resp
        except orchestrator.RunError as e:
            raise handle_run_error(e)


def _config_input(cfg: dict) -> dict:
    out = {k: cfg.get(k) for k in ("objective", "primary_kpi", "flight_start", "flight_end", "age_range", "gender", "income_tiers")}
    bid = cfg.get("bid") or {}
    out.update({"bid_strategy": bid.get("strategy") or cfg.get("bid_strategy"), "cpm_range_usd": bid.get("cpm_range_usd") or cfg.get("cpm_range_usd"),
                "cpc_range_usd": bid.get("cpc_range_usd") or cfg.get("cpc_range_usd")})
    budget = cfg.get("budget") or {}
    out.update({"budget_daily_usd": budget.get("daily_usd", cfg.get("budget_daily_usd")), "budget_total_usd": budget.get("total_usd", cfg.get("budget_total_usd"))})
    flight = cfg.get("flight") or {}
    out["flight_start"] = out["flight_start"] or flight.get("start")
    out["flight_end"] = out["flight_end"] or flight.get("end")
    tg = cfg.get("targeting") or {}
    out["age_range"] = out["age_range"] or tg.get("age_range")
    out["gender"] = out["gender"] or tg.get("gender")
    out["income_tiers"] = out["income_tiers"] or tg.get("income_tiers")
    if cfg.get("allocation") is not None:
        out["allocation"] = [Allocation.model_validate(a).model_dump() for a in cfg["allocation"]]
    return {k: v for k, v in out.items() if v is not None}


class RegenBody(BaseModel):
    instruction: str | None = Field(default=None, max_length=400)


@router.post("/campaigns/{campaign_id}/creatives/{persona_id}/regenerate", response_model=MutationResponse)
async def regenerate(campaign_id: UUID, persona_id: str, body: RegenBody, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        c = await _load(conn, campaign_id, user)
        memory = await repo.load_memory(conn, user.id)
        try:
            resp, _ = await orchestrator.run_single(conn, user, catalog, memory, c, tool_name="regenerate_creative",
                                                    inp={"persona_id": persona_id, "instruction": body.instruction}, kind="regenerate",
                                                    action="regenerate_creative", note=f"Regenerated creative for {persona_id}", mode="repair")
            return resp
        except orchestrator.RunError as e:
            raise handle_run_error(e)


@router.get("/campaigns/{a}/compare/{b}")
async def compare(a: UUID, b: UUID, va: int | None = None, vb: int | None = None, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        A = await _load(conn, a, user)
        B = await _load(conn, b, user)
        if va is not None:
            snap = await repo.get_version_snapshot(conn, A.id, va)
            if snap:
                A = A.model_copy(update=_snap_fields(snap))
        if vb is not None:
            snap = await repo.get_version_snapshot(conn, B.id, vb)
            if snap:
                B = B.model_copy(update=_snap_fields(snap))
    ids = list(dict.fromkeys([*(p.id for p in A.publishers), *(p.id for p in B.publishers)]))
    rows = []
    for pid in ids:
        pa = next((p for p in A.publishers if p.id == pid), None)
        pb = next((p for p in B.publishers if p.id == pid), None)
        rows.append({"publisher_id": pid, "name": catalog.publisher(pid).name, "a": pa.score if pa else None, "b": pb.score if pb else None,
                     "delta": (pb.score - pa.score) if pa and pb else None})
    return {"a": A, "b": B, "publishers": rows,
            "creatives": [{"persona_id": x.persona_id, "a": next((y.headline for y in A.creatives if y.persona_id == x.persona_id), None), "b": x.headline}
                          for x in B.creatives]}


def _snap_fields(snap: dict) -> dict:
    from ..schemas.domain import CampaignConfig, Creative, ExcludedPublisher, PersonaPick, PublisherScore, SkippedPersona
    return {"publishers": [PublisherScore.model_validate(x) for x in snap.get("publishers", [])],
            "excluded": [ExcludedPublisher.model_validate(x) for x in snap.get("excluded", [])],
            "personas": [PersonaPick.model_validate(x) for x in snap.get("personas", [])],
            "skipped_personas": [SkippedPersona.model_validate(x) for x in snap.get("skipped_personas", [])],
            "creatives": [Creative.model_validate(x) for x in snap.get("creatives", [])],
            "config": CampaignConfig.model_validate(snap["config"]) if snap.get("config") else None, "name": snap.get("name")}


@router.get("/credits/estimate")
async def estimate(action: str, user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        bal = await credits.balance(conn, user.id)
    return {**pricing.estimate(action), "balance": bal}
