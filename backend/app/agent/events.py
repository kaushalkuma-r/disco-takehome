"""Yield events: the live progress stream of one turn (a surface-level version of Sentinel's yield-events v2).

Wire shape, one JSON object per SSE `event: yield` line:
    {"kind": "...", "event_id": "e3", "parent_id": "e1", "status": "running|completed|failed", "title": "...", "detail": "..."}

Kinds:
    thought    — what the planner is doing right now ("Reading your campaign…")
    tool_card  — one tool call; emitted `running` then folded (same event_id) to `completed` / `failed`
    tool_event — a progress row under a tool card (generation stages)
    head_text  — visible prose from the planner (the final reply rides on `done`, not here)
    turn_end   — terminal marker

Frontends fold updates by `event_id`: a later event with the same id replaces the earlier one.
Outside a streaming request the emitter is a silent no-op, so the JSON (non-stream) path is untouched.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

KIND_THOUGHT, KIND_TOOL_CARD, KIND_TOOL_EVENT, KIND_HEAD_TEXT, KIND_TURN_END = "thought", "tool_card", "tool_event", "head_text", "turn_end"
RUNNING, COMPLETED, FAILED = "running", "completed", "failed"

Sink = Callable[[dict], Awaitable[None] | None]
_current: ContextVar["Emitter | None"] = ContextVar("yield_emitter", default=None)

# Human labels for tool cards (what the user sees while a tool runs).
TOOL_TITLES = {
    "score_clarity": "Checking how clear the brief is", "generate_campaign": "Building the campaign", "rank_publishers": "Ranking publishers",
    "pick_personas": "Choosing personas", "write_creatives": "Writing creative", "regenerate_creative": "Rewriting the creative",
    "build_config": "Assembling the config", "drop_publisher": "Dropping a publisher", "set_budget": "Updating the budget",
    "update_creative": "Editing the creative", "save_preference": "Saving your preference", "remember_fact": "Remembering that",
    "export_brief": "Preparing the export", "get_campaign": "Reading the campaign details", "add_persona": "Adding a persona",
}


class Emitter:
    def __init__(self, sink: Sink | None):
        self._sink = sink
        self._n = 0

    def _next(self) -> str:
        self._n += 1
        return f"e{self._n}"

    async def emit(self, kind: str, *, event_id: str | None = None, parent_id: str | None = None, status: str | None = None,
                   title: str | None = None, detail: str | None = None, **extra: Any) -> str:
        eid = event_id or self._next()
        if self._sink is None:
            return eid
        ev: dict[str, Any] = {"kind": kind, "event_id": eid}
        if parent_id:
            ev["parent_id"] = parent_id
        if status:
            ev["status"] = status
        if title:
            ev["title"] = title[:120]
        if detail:
            ev["detail"] = detail[:300]
        ev.update({k: v for k, v in extra.items() if v is not None})
        r = self._sink(ev)
        if asyncio.iscoroutine(r):
            await r
        return eid

    async def thought(self, text: str) -> str:
        return await self.emit(KIND_THOUGHT, title=text)

    async def tool_start(self, name: str, detail: str | None = None) -> str:
        return await self.emit(KIND_TOOL_CARD, status=RUNNING, title=TOOL_TITLES.get(name, name.replace("_", " ").capitalize()), detail=detail, tool=name)

    async def tool_end(self, eid: str, name: str, ok: bool, detail: str | None = None) -> None:
        await self.emit(KIND_TOOL_CARD, event_id=eid, status=COMPLETED if ok else FAILED, title=TOOL_TITLES.get(name, name), detail=detail, tool=name)

    async def tool_event(self, parent: str, title: str, status: str, detail: str | None = None, event_id: str | None = None) -> str:
        return await self.emit(KIND_TOOL_EVENT, event_id=event_id, parent_id=parent, status=status, title=title, detail=detail)

    async def text(self, text: str) -> str:
        return await self.emit(KIND_HEAD_TEXT, title=text)

    async def end(self) -> None:
        await self.emit(KIND_TURN_END, status=COMPLETED)


_NOOP = Emitter(None)


def current() -> Emitter:
    return _current.get() or _NOOP


def install(sink: Sink | None) -> Emitter:
    em = Emitter(sink)
    _current.set(em)
    return em
