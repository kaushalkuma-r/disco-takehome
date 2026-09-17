from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, repo
from ..agent.memory import PREFERENCE_KEYS
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..catalog import load_catalog

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("")
async def get_memory(user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        m = await repo.load_memory(conn, user.id)
    return {"preferences": m.preferences, "sources": m.sources, "facts": [f.model_dump() for f in m.facts], "keys": PREFERENCE_KEYS}


class PrefBody(BaseModel):
    key: str
    value: Any


@router.put("/preferences")
async def put_preference(body: PrefBody, user: UserCtx = Depends(get_current_user)):
    if body.key not in PREFERENCE_KEYS:
        raise HTTPException(422, f"unknown key {body.key}")
    if body.key == "banned_publishers":
        cat = load_catalog()
        body.value = [v for v in (body.value or []) if cat.has_publisher(v)]
    async with db.tx() as conn:
        if body.value in (None, "", [], 0):
            await repo.delete_preference(conn, user.id, body.key)
        else:
            await repo.set_preference(conn, user.id, body.key, body.value, "manual")
    return {"ok": True}


@router.delete("/preferences/{key}")
async def delete_preference(key: str, user: UserCtx = Depends(get_current_user)):
    async with db.tx() as conn:
        await repo.delete_preference(conn, user.id, key)
    return {"ok": True}


class FactBody(BaseModel):
    text: str
    campaign_id: UUID | None = None


@router.post("/facts")
async def add_fact(body: FactBody, user: UserCtx = Depends(get_current_user)):
    async with db.tx() as conn:
        fid = await repo.add_fact(conn, user.id, body.text.strip(), "manual", body.campaign_id)
    return {"id": str(fid)}


@router.delete("/facts/{fact_id}")
async def delete_fact(fact_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.tx() as conn:
        await repo.delete_fact(conn, user.id, fact_id)
    return {"ok": True}
