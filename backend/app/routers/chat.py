import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .. import db, repo
from ..agent import chat as chat_agent
from ..agent import events, orchestrator
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..catalog import load_catalog
from .common import handle_run_error, rate_limit

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    thread_id: UUID | None = None
    campaign_id: UUID | None = None


@router.post("")
async def post_message(body: ChatBody, request: Request, user: UserCtx = Depends(get_current_user)):
    """One chat turn. With `Accept: text/event-stream` the response streams `yield` events (thought / tool_card /
    tool_event / head_text / turn_end) and ends with a `done` event carrying the same JSON the plain call returns."""
    rate_limit(user.id, "chat")
    catalog = load_catalog()
    if "text/event-stream" not in request.headers.get("accept", ""):
        async with db.connection() as conn:
            try:
                return await chat_agent.turn(conn, user, catalog, thread_id=body.thread_id, campaign_id=body.campaign_id, message=body.message.strip())
            except orchestrator.RunError as e:
                raise handle_run_error(e)

    queue: asyncio.Queue[dict | None] = asyncio.Queue()

    async def worker() -> None:
        events.install(lambda ev: queue.put({"event": "yield", "data": json.dumps(ev)}))
        try:
            async with db.connection() as conn:
                result = await chat_agent.turn(conn, user, catalog, thread_id=body.thread_id, campaign_id=body.campaign_id, message=body.message.strip())
            await queue.put({"event": "done", "data": json.dumps(result)})
        except orchestrator.RunError as e:
            await queue.put({"event": "error", "data": json.dumps({"code": e.code, "message": e.message, "status": e.status})})
        except Exception as e:  # noqa: BLE001
            await queue.put({"event": "error", "data": json.dumps({"code": "internal", "message": str(e)[:300], "status": 500})})
        finally:
            await queue.put(None)

    async def stream():
        task = asyncio.create_task(worker())
        try:
            while (item := await queue.get()) is not None:
                yield item
        finally:
            if not task.done():
                task.cancel()

    return EventSourceResponse(stream(), ping=15)


@router.get("/{thread_id}")
async def get_thread(thread_id: UUID, user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        if await repo.thread_owner(conn, thread_id) != user.id:
            raise HTTPException(404, "thread not found")
        cid = await conn.fetchval("select campaign_id from threads where id=$1", thread_id)
        return {"thread_id": str(thread_id), "campaign_id": str(cid) if cid else None, "messages": await repo.list_chat_messages(conn, thread_id, user.id)}


@router.get("")
async def list_threads(user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        rows = await conn.fetch(
            """select t.id, t.campaign_id, c.name as campaign_name, t.created_at, (select count(*) from chat_messages m where m.thread_id = t.id) as messages
               from threads t left join campaigns c on c.id = t.campaign_id
               where t.user_id = $1 and exists (select 1 from chat_messages m where m.thread_id = t.id) order by t.created_at desc limit 30""", user.id)
    return [dict(r) for r in rows]
