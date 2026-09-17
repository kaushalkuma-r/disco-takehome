from fastapi import APIRouter, Depends

from .. import db
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..billing import credits, pricing

router = APIRouter(prefix="/api", tags=["credits"])


@router.get("/credits")
async def ledger(user: UserCtx = Depends(get_current_user)):
    async with db.connection() as conn:
        bal = await credits.balance(conn, user.id)
        rows = await credits.ledger(conn, user.id)
        consistent = await credits.assert_ledger_consistent(conn, user.id)
    return {"balance": bal, "grant": pricing.SIGNUP_GRANT, "pricing": {"base": pricing.BASE, "tokens_per_credit": pricing.TOKENS_PER_CREDIT, "model_weight": pricing.MODEL_WEIGHT},
            "ledger": rows, "consistent": consistent}
