"""Credit ledger operations. The ledger is the source of truth; profiles.credit_balance is a
denormalised copy guarded by `select ... for update` so concurrent charges serialise."""
from __future__ import annotations

from uuid import UUID

import asyncpg

from ..llm.usage import Usage
from ..schemas.domain import CreditsInfo
from . import pricing


class InsufficientCredits(Exception):
    def __init__(self, balance: int, needed: int):
        super().__init__(f"balance {balance} < needed {needed}")
        self.balance, self.needed = balance, needed


async def _lock_balance(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await conn.fetchval("select credit_balance from profiles where id = $1 for update", user_id)


async def _write(conn: asyncpg.Connection, user_id: UUID, delta: int, reason: str, *, interaction_id: UUID | None = None,
                 campaign_id: UUID | None = None, usage: dict | None = None) -> int:
    # Own (possibly nested → savepoint) transaction so the lock never spans an LLM call.
    async with conn.transaction():
        balance = await _lock_balance(conn, user_id)
        new_balance = balance + delta
        await conn.execute("update profiles set credit_balance = $2 where id = $1", user_id, new_balance)
        await conn.execute(
            "insert into credit_ledger (user_id, interaction_id, campaign_id, delta, reason, usage, balance_after) values ($1,$2,$3,$4,$5,$6,$7)",
            user_id, interaction_id, campaign_id, delta, reason, usage, new_balance)
    return new_balance


async def grant_signup(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await _write(conn, user_id, pricing.SIGNUP_GRANT, "signup_grant")


async def balance(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await conn.fetchval("select credit_balance from profiles where id = $1", user_id) or 0


async def reserve(conn: asyncpg.Connection, user_id: UUID, action: str, *, interaction_id: UUID | None, campaign_id: UUID | None = None) -> int:
    """Charge the base fee up front. Raises InsufficientCredits (nothing written) when the balance is too low."""
    base = pricing.base_for(action)
    async with conn.transaction():
        bal = await _lock_balance(conn, user_id)
        if bal < base:
            raise InsufficientCredits(bal, base)
        if base:
            return await _write(conn, user_id, -base, "reserve", interaction_id=interaction_id, campaign_id=campaign_id)
    return bal


async def settle(conn: asyncpg.Connection, user_id: UUID, action: str, usage: Usage, *, interaction_id: UUID | None, campaign_id: UUID | None = None) -> CreditsInfo:
    """Charge actual usage after the run. Balance may go slightly negative on a big run; it never blocks a completed job."""
    base = pricing.base_for(action)
    used = pricing.tokens_to_credits(usage)
    if used:
        new_balance = await _write(conn, user_id, -used, "usage", interaction_id=interaction_id, campaign_id=campaign_id, usage=usage.to_json())
    else:
        new_balance = await balance(conn, user_id)
    return CreditsInfo(charged=base + used, base=base, usage=used, balance=new_balance)


async def refund(conn: asyncpg.Connection, user_id: UUID, action: str, *, interaction_id: UUID | None, campaign_id: UUID | None = None) -> int:
    base = pricing.base_for(action)
    if base:
        return await _write(conn, user_id, base, "refund", interaction_id=interaction_id, campaign_id=campaign_id)
    return await balance(conn, user_id)


async def ledger(conn: asyncpg.Connection, user_id: UUID, limit: int = 200) -> list[dict]:
    rows = await conn.fetch(
        """select l.id, l.created_at, l.reason, l.delta, l.usage, l.balance_after, l.campaign_id, c.name as campaign_name, i.kind as interaction_kind
           from credit_ledger l left join campaigns c on c.id = l.campaign_id left join interactions i on i.id = l.interaction_id
           where l.user_id = $1 order by l.created_at desc limit $2""", user_id, limit)
    return [dict(r) for r in rows]


async def assert_ledger_consistent(conn: asyncpg.Connection, user_id: UUID) -> bool:
    s = await conn.fetchval("select coalesce(sum(delta),0) from credit_ledger where user_id = $1", user_id)
    return s == await balance(conn, user_id)
