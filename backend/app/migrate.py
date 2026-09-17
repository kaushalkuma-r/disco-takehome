"""Apply backend/migrations/*.sql in order (idempotent). Usage: python -m app.migrate"""
from __future__ import annotations

import asyncio
from pathlib import Path

import asyncpg

from .config import get_settings


async def main() -> None:
    conn = await asyncpg.connect(get_settings().database_url, statement_cache_size=0)
    try:
        for path in sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql")):
            await conn.execute(path.read_text())
            print("applied", path.name)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
