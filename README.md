# Disco Campaign Studio

An advertiser describes their business in a sentence. Campaign Studio returns **where to run** (ranked publishers with reasons *and* exclusions), **who to speak to** (persona-tuned creative), and **how to run it** (a structured, editable campaign config) — with every decision explained, every model call metered in credits, and feedback that repairs the output in place.

Live demo: https://campaign-studio-a1dk.onrender.com (Render free tier; first load after idle takes ~1 min) · Prototype: https://claude.ai/artifact/BZcMjBq8WvNTHcMq9Dgsuy · Design docs: [`docs/design/`](docs/design/) · Prompts: [`prompts/`](prompts/)

## What I built

- **Clarity gate (free).** Every brief is scored 0–100 first. Below 60 the user answers ≤3 multiple-choice questions before any credits are spent, so *"We help people feel better"* becomes *"wellness supplements, general consumers, budget"* instead of a confident wrong plan.
- **Hybrid ranking.** A deterministic pre-score (category 35 · persona 30 · AOV 15 · audience 20, unit-tested against golden briefs) plus a model adjustment bounded to ±15 that must cite the publisher's catalog note. Exclusions carry reasons. Weak briefs still get three capped "reach test" placements.
- **Persona-tuned creative.** 3–5 variants written to each persona's messaging preferences and away from its disinterests; fit score and "why this persona" are shown; regenerate one variant with an instruction.
- **Campaign config.** Objective, KPI, bid strategy + ranges with a written rationale, budget/flight, targeting, per-publisher allocation (fit × log reach, capped at 45%), creative↔placement links. Editable form with live JSON; exported as JSON or a one-page PDF brief.
- **Agentic core.** One orchestrator (guided / free / repair modes) calls typed tools, runs **11 validators** after every change, repairs failures once during generation, versions every change, and settles credits from real token usage. The wizard, the chat and the 👍/👎 buttons are three doors into the same tools.
- **Streaming.** Generation streams stage events over SSE (parse → rank → personas → creative → config → checks) so the UI shows what is happening, including auto-repairs, as they occur.
- **Feedback that acts.** 👎 + comment on a publisher, creative, persona or config re-runs only that tool. **Memory** (brand voice, banned publishers/words, default budget, facts) is set explicitly or from chat ("never use Swiftcart") and enforced by checks. **Credits**: 100 on signup, base fee + 1 credit per 4k weighted tokens (gpt-4.1 = 2×), deterministic edits free, ledger sum = balance always.
- **Login** (Supabase Auth; ES256 JWTs verified against the project JWKS), history + compare across runs, activity timeline, dark mode, mobile.
- **Observability.** Every interaction is a Langfuse trace shaped like the agent: an `agent` root (user + thread as session), a `tool` span per tool call, a `generation` per model call with prompt name/version, tokens and cost, and a `guardrail` span for the validator/repair pass. Set `LANGFUSE_*` in `.env`; without keys tracing is a no-op.

## Run it

```bash
cp .env.example .env            # OPENAI_API_KEY, SUPABASE_URL/ANON/SERVICE_ROLE keys, DATABASE_URL (session pooler, IPv4), optional LANGFUSE_*
cd backend && uv venv .venv && uv pip install -e ".[dev]" && .venv/bin/python -m app.migrate && ./run_api.sh start   # API on :8000
cd frontend && cp .env.example .env.local && npm install && npm run dev                                              # UI on :3000
```
Supabase: free project → Authentication → Providers → Email → turn **off** "Confirm email". `app.migrate` creates 11 tables with RLS. `frontend/.env.local` needs the public URL + anon key and `NEXT_PUBLIC_API_URL=http://localhost:8000`.

**Single container (what the demo runs):** `docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=… -t campaign-studio . && docker run --env-file .env -e SERVE_STATIC=1 -p 8000:8000 campaign-studio` — FastAPI serves the Next.js static export and `/api/*` from one 85 MB image.

**Tests:** `backend/.venv/bin/pytest` (unit: scoring golden cases, validators, pricing, memory) · `backend/tests/e2e_api.py` (every endpoint, live Supabase + OpenAI) · `tools/e2e_browser.py` (Playwright through the real UI, also run against the container) · `tools/audit_app.py` (contrast/layout/touch-target audit, light+dark, desktop+mobile) · `tools/load_test.py`.

## Deploy free (verified Sept 2026)

| | Where | Notes |
|---|---|---|
| **Shape A** — one service | **Render** free web service ([`render.yaml`](render.yaml)); Koyeb / Hugging Face Spaces take the same Dockerfile | 512 MB, sleeps after 15 min idle, ~1 min cold start. Choose the region nearest your Supabase project. |
| **Shape B** — split | **Vercel** (frontend, [`frontend/vercel.json`](frontend/vercel.json)) + Render (API) | Set `NEXT_PUBLIC_API_URL` on Vercel and `CORS_ORIGINS` on the API. Same code, one env var. |
| Data + auth | **Supabase** free | Postgres + Auth; nothing self-hosted. |

Railway is no longer free (a one-time $5 trial), so it was dropped from the plan.

## Scale: what it handles today, and how it grows

Measured locally with the worst-case topology (API in Mumbai, Supabase in Seoul, 264 ms per DB round trip): **8 concurrent generations** complete with zero errors at p50 23 s / p95 46 s, first stage event in ~3 s; **40 concurrent reads** at ~10 req/s (p50 2.2 s) after collapsing each request to 1–2 round trips. One generation ≈ 8.5k tokens, ~15 s of model time, ≈13 credits, ≈$0.01. A free 512 MB container serves a few dozen simultaneous users; the ceiling is model latency and the 10-connection pool, not CPU.

Next steps in order: (1) co-locate API and DB (264 → ~2 ms turns 10 req/s into hundreds); (2) move generation to a queue + workers and stream progress from Redis instead of holding the request, with an idempotency key per run; (3) Redis for the rate limiter and profile cache that are in-process today; (4) pgvector recall once the catalog is 10k+ publishers, keeping the deterministic + LLM rerank on the top-50; (5) cache clarity by brief hash and batch creative calls; (6) golden-set evals in CI (ranking NDCG vs. labels, LLM-judge copy rubric) keyed on the prompt `version` already stored per interaction.

## Another week · what I cut · hard vs. easy

**Next week:** eval harness on the 15 example briefs with human labels; version-vs-version compare in the UI (API supports it); Google login (a Supabase switch); image creative; real CPM benchmarks per publisher.
**Cut on purpose:** playbooks (preferences + re-run cover it), PPTX (one export done well), SSR (a static export runs anywhere free), vector search (20 publishers fit in one prompt).
**Hard:** ranking that is explainable *and* right at the margins; copy that reads persona-specific without parroting keywords; deciding when a brief is vague enough to interrupt; keeping model JSON stable under prompt changes. **Easy:** CRUD, auth, the config shape, PDF, the chat loop once the tools exist. **Where the engineering lives:** the boundary between deterministic scoring and model judgment, the validators that catch the model when it is wrong, and the eval loop that proves a prompt change made rankings better rather than different.

## Repository

```
backend/   FastAPI · app/agent (orchestrator, registry, tools, validators, memory, chat) · billing · services · routers · migrations · tests
frontend/  Next.js 15 static export · app/{login,dashboard,new,campaign,chat,history,compare,memory,credits} · lib (api, session, ui)
prompts/   every prompt, versioned frontmatter          data/  the mock data pack          docs/design/  HLD · LLD (Mermaid) + rendered HTML
design/    clickable prototype + screenshot reviews     tools/ reviewer, browser E2E, audit, load test
```
