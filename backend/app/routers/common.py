"""Shared router helpers: error envelope and a tiny in-memory rate limiter (Redis at scale)."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from uuid import UUID

from fastapi import HTTPException

from ..agent.orchestrator import RunError
from ..config import get_settings

_buckets: dict[tuple[UUID, str], deque[float]] = defaultdict(deque)


def rate_limit(user_id: UUID, kind: str) -> None:
    s = get_settings()
    limit = s.rate_generate_per_min if kind == "generate" else s.rate_chat_per_min
    q = _buckets[(user_id, kind)]
    now = time.monotonic()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, detail={"code": "rate_limited", "message": f"Too many {kind} requests; try again in a minute.", "retry_after": 60})
    q.append(now)


def handle_run_error(e: RunError) -> HTTPException:
    detail = {"code": e.code, "message": e.message}
    if e.payload:
        detail["payload"] = e.payload
    return HTTPException(e.status, detail=detail)
