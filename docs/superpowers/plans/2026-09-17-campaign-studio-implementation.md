# Campaign Studio Implementation Plan

**Goal:** Ship the FastAPI + Next.js implementation of the design in `docs/design/LLD.md`, running end to end locally against Supabase and OpenAI, deployable free (Render single container, or Vercel + Render).

**Architecture:** One repo, `backend/` (FastAPI agent core: orchestrator → typed tools → validators → credits → versioned persistence, SSE streaming) and `frontend/` (Next.js static export that reproduces `design/prototype/` pixel-for-pixel by reusing its stylesheet). Supabase Auth (ES256 JWKS-verified JWTs) + Postgres (asyncpg via the IPv4 pooler). Prompts live in `prompts/`.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, asyncpg, openai (structured outputs), PyJWT (JWKS), sse-starlette, fpdf2, pytest · Node 20, Next.js 15 (App Router, `output: 'export'`), React 19, TypeScript, @supabase/supabase-js, @tanstack/react-query.

**Spec:** `docs/design/LLD.md` (+ `docs/design/HLD.md`). Prototype behaviour reference: `design/prototype/assets/js/core.js` (validators, pricing, api shapes).

## Global constraints
- No `Co-Authored-By` trailers; commit as Kaushal Kumar <kaushal@genloop.ai>.
- Secrets only in `.env`; `prompts/` contains no keys.
- Free-tier deployable: image < 1 GB, cold start answers `/healthz` < 5 s, no background daemons.
- Every mutating endpoint returns `{campaign, validation, credits}`.
- Credits: 100 on signup; base + ceil(weighted_tokens / 4000); gpt-4.1 weight 2×; deterministic ops free; ledger sum == balance.

## Milestones (each ends green and committed)

- [ ] **M1 Backend core (no DB):** config, catalog, schemas, deterministic `scoring.py` + golden tests, validators + tests, pricing + tests, LLM client with usage capture, tools (clarity, rank, personas, creatives, config) against real OpenAI with recorded fixtures, prompts in `prompts/`.
- [ ] **M2 Persistence + auth:** `migrations/001_init.sql`, `db.py`, JWKS auth dependency, profiles + signup grant, threads/interactions, credits reserve/settle/refund with `FOR UPDATE`, campaign repo with versions.
- [ ] **M3 Orchestrator + API:** guided/free/repair modes, SSE `POST /api/campaigns` stage stream, PATCH ops, regenerate, feedback, memory, credits, compare, export (PDF/JSON), chat with OpenAI function calling, `/healthz`.
- [ ] **M4 Frontend:** Next.js static export with the prototype stylesheet, Supabase auth, all screens (login, dashboard, wizard with live SSE stages, campaign tabs incl. checks/activity, chat, history/compare, memory, credits), typed API client.
- [ ] **M5 E2E + deploy:** Playwright E2E against the real stack, Dockerfile (Shape A), `render.yaml`, Vercel config (Shape B), README with run instructions, scale numbers and next steps.
