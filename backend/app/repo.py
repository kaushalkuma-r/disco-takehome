"""Persistence for campaigns, threads, interactions, versions, validation, memory, feedback, chat.

Plain SQL over asyncpg. Every function takes the connection so callers control transactions.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import asyncpg

from .agent.memory import Fact, MemoryBlock
from .schemas.domain import Campaign, ClarityResult, ParsedBrief, ValidationResult

_CAMPAIGN_COLS = "id, user_id, thread_id, parent_campaign_id, name, brief, clarity, parsed_brief, publishers, excluded, personas, creatives, config, status, version, created_at, updated_at"


# ----------------------------------------------------------------------------- threads / interactions
async def create_thread(conn: asyncpg.Connection, user_id: UUID, campaign_id: UUID | None = None) -> UUID:
    return await conn.fetchval("insert into threads (user_id, campaign_id) values ($1, $2) returning id", user_id, campaign_id)


async def link_thread(conn: asyncpg.Connection, thread_id: UUID, campaign_id: UUID) -> None:
    await conn.execute("update threads set campaign_id = $2 where id = $1", thread_id, campaign_id)


async def thread_owner(conn: asyncpg.Connection, thread_id: UUID) -> UUID | None:
    return await conn.fetchval("select user_id from threads where id = $1", thread_id)


async def open_interaction(conn: asyncpg.Connection, thread_id: UUID, user_id: UUID, kind: str, mode: str, input_: dict, prompt_versions: dict) -> UUID:
    return await conn.fetchval(
        "insert into interactions (thread_id, user_id, kind, mode, input, prompt_versions) values ($1,$2,$3,$4,$5,$6) returning id",
        thread_id, user_id, kind, mode, input_, prompt_versions)


async def close_interaction(conn: asyncpg.Connection, interaction_id: UUID, *, status: str, plan: list, usage: dict, credits_base: int,
                            credits_usage: int, duration_ms: int) -> None:
    await conn.execute(
        "update interactions set status=$2, plan=$3, usage=$4, credits_base=$5, credits_usage=$6, duration_ms=$7 where id=$1",
        interaction_id, status, plan, usage, credits_base, credits_usage, duration_ms)


# ----------------------------------------------------------------------------- campaigns
def _to_campaign(row) -> Campaign:
    d = dict(row)
    # jsonb columns come back as python objects; personas/skipped stored inside `personas` as {"chosen":[], "skipped":[]}
    personas = d.pop("personas") or {}
    if isinstance(personas, list):  # legacy shape guard
        personas = {"chosen": personas, "skipped": []}
    if not d.get("config"):  # jsonb default '{}' means "no config yet"
        d["config"] = None
    return Campaign(**d, personas=personas.get("chosen", []), skipped_personas=personas.get("skipped", []))


def _from_campaign(c: Campaign) -> dict:
    d = c.model_dump(mode="json")
    d["personas"] = {"chosen": d.pop("personas"), "skipped": d.pop("skipped_personas")}
    return d


async def create_campaign(conn: asyncpg.Connection, *, user_id: UUID, thread_id: UUID, name: str, brief: str, clarity: ClarityResult,
                          parsed: ParsedBrief, parent_campaign_id: UUID | None = None, status: str = "generating") -> Campaign:
    row = await conn.fetchrow(
        f"""insert into campaigns (user_id, thread_id, parent_campaign_id, name, brief, clarity, parsed_brief, status)
            values ($1,$2,$3,$4,$5,$6,$7,$8) returning {_CAMPAIGN_COLS}""",
        user_id, thread_id, parent_campaign_id, name, brief, clarity.model_dump(mode="json"), parsed.model_dump(mode="json"), status)
    return _to_campaign(row)


async def save_campaign(conn: asyncpg.Connection, c: Campaign) -> Campaign:
    d = _from_campaign(c)
    row = await conn.fetchrow(
        f"""update campaigns set name=$2, clarity=$3, parsed_brief=$4, publishers=$5, excluded=$6, personas=$7, creatives=$8, config=$9, status=$10,
            version=$11, updated_at=now() where id=$1 returning {_CAMPAIGN_COLS}""",
        c.id, d["name"], d["clarity"], d["parsed_brief"], d["publishers"], d["excluded"], d["personas"], d["creatives"], d["config"] or {}, d["status"], d["version"])
    return _to_campaign(row)


async def get_campaign_with_balance(conn: asyncpg.Connection, campaign_id: UUID, user_id: UUID) -> tuple[Campaign | None, int]:
    row = await conn.fetchrow(f"select {_CAMPAIGN_COLS}, (select credit_balance from profiles where id=$2) as balance from campaigns where id=$1 and user_id=$2", campaign_id, user_id)
    if not row:
        return None, 0
    d = dict(row)
    bal = d.pop("balance") or 0
    return _to_campaign(d), bal


async def get_campaign(conn: asyncpg.Connection, campaign_id: UUID, user_id: UUID) -> Campaign | None:
    row = await conn.fetchrow(f"select {_CAMPAIGN_COLS} from campaigns where id=$1 and user_id=$2", campaign_id, user_id)
    return _to_campaign(row) if row else None


async def list_campaigns(conn: asyncpg.Connection, user_id: UUID) -> list[Campaign]:
    rows = await conn.fetch(f"select {_CAMPAIGN_COLS} from campaigns where user_id=$1 and status <> 'generating' order by created_at desc", user_id)
    return [_to_campaign(r) for r in rows]


async def delete_campaign(conn: asyncpg.Connection, campaign_id: UUID, user_id: UUID) -> bool:
    return (await conn.execute("delete from campaigns where id=$1 and user_id=$2", campaign_id, user_id)).endswith("1")


async def snapshot_version(conn: asyncpg.Connection, c: Campaign, interaction_id: UUID | None, note: str) -> None:
    await conn.execute(
        "insert into campaign_versions (campaign_id, version, snapshot, interaction_id, change_note) values ($1,$2,$3,$4,$5) on conflict (campaign_id, version) do nothing",
        c.id, c.version, c.snapshot(), interaction_id, note)


async def list_versions(conn: asyncpg.Connection, campaign_id: UUID) -> list[dict]:
    rows = await conn.fetch("select version, snapshot, change_note, created_at, interaction_id from campaign_versions where campaign_id=$1 order by version", campaign_id)
    return [dict(r) for r in rows]


async def get_version_snapshot(conn: asyncpg.Connection, campaign_id: UUID, version: int) -> dict | None:
    return await conn.fetchval("select snapshot from campaign_versions where campaign_id=$1 and version=$2", campaign_id, version)


async def save_validation(conn: asyncpg.Connection, interaction_id: UUID, campaign_id: UUID, results: list[ValidationResult]) -> None:
    await conn.executemany(
        "insert into validation_results (interaction_id, campaign_id, check_id, severity, passed, message, target, repair_tool) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [(interaction_id, campaign_id, r.check, r.severity, r.passed, r.message, r.target, r.repair_tool) for r in results])


async def activity(conn: asyncpg.Connection, campaign_id: UUID, user_id: UUID) -> list[dict]:
    """Timeline: interactions on the campaign's thread plus feedback rows, newest first."""
    rows = await conn.fetch(
        """select i.id, i.kind, i.mode, i.status, i.created_at, i.credits_base + i.credits_usage as credits, i.duration_ms, i.input,
                  v.change_note
           from interactions i
           join threads t on t.id = i.thread_id
           left join campaign_versions v on v.interaction_id = i.id
           where t.campaign_id = $1 and i.user_id = $2 order by i.created_at desc limit 50""", campaign_id, user_id)
    return [dict(r) for r in rows]


# ----------------------------------------------------------------------------- memory
async def load_memory(conn: asyncpg.Connection, user_id: UUID) -> MemoryBlock:
    """Preferences + facts in a single round trip (the DB may be in another region; every query costs ~250 ms)."""
    row = await conn.fetchrow(
        """select coalesce((select json_agg(json_build_object('key', key, 'value', value, 'source', source, 'updated_at', updated_at)) from preferences where user_id=$1), '[]'::json) as prefs,
                  coalesce((select json_agg(json_build_object('id', id, 'text', text, 'source', source, 'campaign_id', campaign_id, 'created_at', created_at) order by created_at)
                            from facts where user_id=$1), '[]'::json) as facts""", user_id)
    prefs, facts = row["prefs"], row["facts"]
    return MemoryBlock(
        preferences={r["key"]: r["value"] for r in prefs},
        sources={r["key"]: {"source": r["source"], "at": r["updated_at"]} for r in prefs},
        facts=[Fact(id=str(r["id"]), text=r["text"], source=r["source"], campaign_id=str(r["campaign_id"]) if r["campaign_id"] else None, created_at=r["created_at"]) for r in facts])


async def set_preference(conn: asyncpg.Connection, user_id: UUID, key: str, value, source: str, interaction_id: UUID | None = None) -> None:
    await conn.execute(
        """insert into preferences (user_id, key, value, source, origin_interaction_id) values ($1,$2,$3,$4,$5)
           on conflict (user_id, key) do update set value=excluded.value, source=excluded.source, origin_interaction_id=excluded.origin_interaction_id, updated_at=now()""",
        user_id, key, value, source, interaction_id)


async def merge_list_preference(conn: asyncpg.Connection, user_id: UUID, key: str, items: list, source: str, interaction_id: UUID | None = None) -> list:
    cur = await conn.fetchval("select value from preferences where user_id=$1 and key=$2", user_id, key) or []
    merged = list(dict.fromkeys([*cur, *items]))
    await set_preference(conn, user_id, key, merged, source, interaction_id)
    return merged


async def delete_preference(conn: asyncpg.Connection, user_id: UUID, key: str) -> None:
    await conn.execute("delete from preferences where user_id=$1 and key=$2", user_id, key)


async def add_fact(conn: asyncpg.Connection, user_id: UUID, text: str, source: str, campaign_id: UUID | None = None, interaction_id: UUID | None = None) -> UUID:
    return await conn.fetchval("insert into facts (user_id, campaign_id, text, source, origin_interaction_id) values ($1,$2,$3,$4,$5) returning id",
                               user_id, campaign_id, text, source, interaction_id)


async def delete_fact(conn: asyncpg.Connection, user_id: UUID, fact_id: UUID) -> None:
    await conn.execute("delete from facts where user_id=$1 and id=$2", user_id, fact_id)


# ----------------------------------------------------------------------------- feedback / chat
async def add_feedback(conn: asyncpg.Connection, *, user_id: UUID, campaign_id: UUID, interaction_id: UUID | None, target_kind: str, target_id: str,
                       vote: str, comment: str | None) -> UUID:
    return await conn.fetchval(
        "insert into feedback (user_id, campaign_id, interaction_id, target_kind, target_id, vote, comment) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        user_id, campaign_id, interaction_id, target_kind, target_id, vote, comment)


async def link_feedback_repair(conn: asyncpg.Connection, feedback_id: UUID, repair_interaction_id: UUID) -> None:
    await conn.execute("update feedback set repair_interaction_id=$2 where id=$1", feedback_id, repair_interaction_id)


async def list_feedback(conn: asyncpg.Connection, campaign_id: UUID, user_id: UUID) -> list[dict]:
    rows = await conn.fetch("select target_kind, target_id, vote, comment, created_at from feedback where campaign_id=$1 and user_id=$2 order by created_at", campaign_id, user_id)
    return [dict(r) for r in rows]


async def add_chat_message(conn: asyncpg.Connection, thread_id: UUID, user_id: UUID, role: str, content, cards: list | None = None, interaction_id: UUID | None = None) -> None:
    await conn.execute("insert into chat_messages (thread_id, user_id, role, content, cards, interaction_id) values ($1,$2,$3,$4,$5,$6)",
                       thread_id, user_id, role, content, cards or [], interaction_id)


async def list_chat_messages(conn: asyncpg.Connection, thread_id: UUID, user_id: UUID, limit: int = 60) -> list[dict]:
    rows = await conn.fetch("select role, content, cards, created_at from chat_messages where thread_id=$1 and user_id=$2 order by created_at desc limit $3",
                            thread_id, user_id, limit)
    return [dict(r) for r in reversed(rows)]


def now() -> datetime:
    return datetime.now(timezone.utc)
