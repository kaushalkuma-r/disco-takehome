"""👍/👎 on any unit. A 👎 with a comment triggers a targeted repair through the orchestrator."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, repo
from ..agent import orchestrator
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..catalog import load_catalog
from .common import handle_run_error

router = APIRouter(prefix="/api", tags=["feedback"])

REPAIR = {  # target kind → (tool, input builder)
    "creative": ("regenerate_creative", lambda t, c: {"persona_id": t, "instruction": c}),
    "publisher": ("rank_publishers", lambda t, c: {"focus_publisher_id": t, "instruction": c}),
    "persona": ("pick_personas", lambda t, c: {"exclude_persona_ids": [t], "instruction": c}),
    "config": ("build_config", lambda t, c: {"instruction": c}),
}


class FeedbackBody(BaseModel):
    campaign_id: UUID
    target_kind: Literal["publisher", "creative", "persona", "config", "clarity"]
    target_id: str
    vote: Literal["up", "down"]
    comment: str | None = Field(default=None, max_length=400)


@router.post("/feedback")
async def feedback(body: FeedbackBody, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        c = await repo.get_campaign(conn, body.campaign_id, user.id)
        if not c:
            raise HTTPException(404, "campaign not found")
        fid = await repo.add_feedback(conn, user_id=user.id, campaign_id=c.id, interaction_id=None, target_kind=body.target_kind, target_id=body.target_id,
                                      vote=body.vote, comment=body.comment)
        repair = None
        if body.vote == "down" and body.comment and body.target_kind in REPAIR:
            tool, build = REPAIR[body.target_kind]
            memory = await repo.load_memory(conn, user.id)
            try:
                resp, iid = await orchestrator.run_single(conn, user, catalog, memory, c, tool_name=tool, inp=build(body.target_id, body.comment.strip()),
                                                          kind="feedback", action="feedback_repair", note=f"Repaired {body.target_kind} from feedback", mode="repair")
            except orchestrator.RunError as e:
                raise handle_run_error(e)
            await repo.link_feedback_repair(conn, fid, iid)
            repair = resp
    return {"feedback_id": str(fid), "repair": repair}
