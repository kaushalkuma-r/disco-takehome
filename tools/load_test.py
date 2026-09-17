#!/usr/bin/env python
"""Small load test: N concurrent generations + M concurrent read bursts against a running API.

    .venv/bin/python tools/load_test.py --api http://localhost:8000 --gens 5 --reads 40

Reports latency percentiles and error counts so the README's capacity numbers are measured, not guessed.
Creates and deletes throwaway users. Costs real OpenAI tokens (~5 generations ≈ $0.05).
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import get_settings  # noqa: E402

S = get_settings()
BRIEFS = [
    "We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based.",
    "A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective.",
    "Small-batch candles poured by hand in Vermont. Natural soy wax, no synthetic fragrances. Mostly bought as gifts.",
    "Refillable, concentrated cleaning products. Skip the single-use plastic bottles. Works as well as the big brands.",
    "Bedding. Linen. Actually-breathable stuff made in Portugal. Our customers want something a little more grown-up.",
    "We sell protein bars that don't taste like cardboard. That's basically the whole pitch.",
    "A subscription box for new cat owners. First three months of their cat's life. Toys, food samples, a little booklet.",
    "Technical outerwear for serious backcountry skiers. Our shells are what patrollers wear. Starts at $650.",
]


async def signup(client: httpx.AsyncClient) -> tuple[str, str]:
    email = f"load-{uuid.uuid4().hex[:6]}@example.com"
    r = await client.post(f"{S.supabase_url}/auth/v1/signup", headers={"apikey": S.supabase_anon_key}, json={"email": email, "password": "disco-demo-123"})
    j = r.json()
    return j["access_token"], j["user"]["id"]


async def delete_user(client: httpx.AsyncClient, uid: str) -> None:
    await client.delete(f"{S.supabase_url}/auth/v1/admin/users/{uid}", headers={"apikey": S.supabase_service_role_key, "Authorization": f"Bearer {S.supabase_service_role_key}"})


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--gens", type=int, default=5)
    ap.add_argument("--reads", type=int, default=40)
    a = ap.parse_args()
    async with httpx.AsyncClient(timeout=240) as client:
        users = await asyncio.gather(*[signup(client) for _ in range(a.gens)])
        try:
            # ---- concurrent generations
            gen_lat: list[float] = []; gen_err: list[str] = []; first_stage: list[float] = []
            async def gen(tok: str, brief: str):
                t0 = time.perf_counter(); seen_first = False
                try:
                    async with client.stream("POST", f"{a.api}/api/campaigns", json={"brief": brief}, headers={"Authorization": f"Bearer {tok}", "Accept": "text/event-stream"}) as r:
                        async for line in r.aiter_lines():
                            if line.startswith("event: stage") and not seen_first:
                                first_stage.append(time.perf_counter() - t0); seen_first = True
                            if line.startswith("event: error"):
                                gen_err.append("error event")
                    gen_lat.append(time.perf_counter() - t0)
                except Exception as e:  # noqa: BLE001
                    gen_err.append(str(e)[:80])
            t0 = time.perf_counter()
            await asyncio.gather(*[gen(tok, BRIEFS[i % len(BRIEFS)]) for i, (tok, _) in enumerate(users)])
            wall = time.perf_counter() - t0
            print(f"generations: {a.gens} concurrent · wall {wall:.1f}s · p50 {pct(gen_lat,50):.1f}s · p95 {pct(gen_lat,95):.1f}s · first stage p50 {pct(first_stage,50):.2f}s · errors {len(gen_err)} {gen_err[:2]}")

            # ---- concurrent reads (list + get + credits) with the first user
            tok = users[0][0]
            H = {"Authorization": f"Bearer {tok}"}
            lst = (await client.get(f"{a.api}/api/campaigns", headers=H)).json()
            cid = lst[0]["id"] if lst else None
            read_lat: list[float] = []; read_err = 0
            async def read(i: int):
                nonlocal read_err
                path = ["/api/campaigns", f"/api/campaigns/{cid}", "/api/credits", "/api/me"][i % 4]
                t = time.perf_counter()
                try:
                    r = await client.get(f"{a.api}{path}", headers=H)
                    if r.status_code != 200:
                        read_err += 1
                except Exception:  # noqa: BLE001
                    read_err += 1
                read_lat.append(time.perf_counter() - t)
            t0 = time.perf_counter()
            await asyncio.gather(*[read(i) for i in range(a.reads)])
            wall = time.perf_counter() - t0
            print(f"reads: {a.reads} concurrent · wall {wall:.2f}s · p50 {pct(read_lat,50)*1000:.0f}ms · p95 {pct(read_lat,95)*1000:.0f}ms · rps {a.reads/wall:.0f} · errors {read_err}")
        finally:
            await asyncio.gather(*[delete_user(client, uid) for _, uid in users])
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
