from fastapi import APIRouter, Depends

from .. import db
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..catalog import load_catalog

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me")
async def me(user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        row = await conn.fetchrow(
            """select (select credit_balance from profiles where id=$1) as bal,
                      (select count(*) from campaigns where user_id=$1 and status <> 'generating') as n,
                      (select count(*) from preferences where user_id=$1) as p,
                      (select count(*) from facts where user_id=$1) as f""", user.id)
    return {"user": {"id": str(user.id), "email": user.email, "name": user.name}, "credit_balance": row["bal"] or 0, "campaigns_count": row["n"],
            "preferences_count": row["p"], "facts_count": row["f"], "examples": load_catalog().examples}


@router.get("/catalog")
async def catalog(user: UserCtx = Depends(get_current_user)):
    cat = load_catalog()
    return {"publishers": [p.model_dump() for p in cat.publishers], "personas": [p.model_dump() for p in cat.personas]}
