# Disco Campaign Studio

> Take-home for Disco: an advertiser describes their business in a sentence; the system returns **where to run** (ranked publishers with reasons and exclusions), **who to speak to** (persona-tuned creative), and **how to run it** (a structured, editable campaign config) — with every decision explained, every model call metered in credits, and feedback that repairs the output.

**Status: design phase complete, implementation next.** This first commit contains the product design, the architecture (HLD + LLD), a fully clickable prototype in Disco's design language, and the tooling that reviews it. The FastAPI + Next.js implementation follows the LLD in `docs/design/`.

| Artifact | Where |
|---|---|
| Clickable prototype | [`design/prototype/`](design/prototype/) · live: https://claude.ai/artifact/BZcMjBq8WvNTHcMq9Dgsuy |
| HLD (architecture, deployment shapes, scale-out) | [`docs/design/HLD.md`](docs/design/HLD.md) · rendered [`hld-blueprint.html`](docs/design/hld-blueprint.html) |
| LLD (agent core, tools, validators, memory, credits, flows, API, data model) | [`docs/design/LLD.md`](docs/design/LLD.md) · rendered [`lld.html`](docs/design/lld.html) |
| Prototype review (56 screenshots + automated audit) | [`design/review/`](design/review/) |
| Assignment + glossary | [`docs/ASSIGNMENT.md`](docs/ASSIGNMENT.md) · [`GLOSSARY.md`](GLOSSARY.md) |
| Mock data pack | [`data/`](data/) |

## What it does

1. **Clarity gate (free).** The brief is scored 0–100 before anything is generated. Below 60, the user answers up to three multiple-choice questions; a vague brief never yields a confident-looking wrong plan.
2. **Ranked publishers, explained.** Deterministic pre-score (category 35 · persona 30 · AOV 15 · audience 20) plus a bounded LLM adjustment (±15) that must cite a catalog note. Exclusions carry reasons too.
3. **Persona-tuned creative.** 3–5 variants, each written to a persona's messaging preferences and away from its disinterests, with a fit score and "why this persona".
4. **Campaign config.** Objective, KPI, bid strategy and ranges, budget/flight, targeting, per-publisher allocation, creative↔placement links — editable, exported as JSON or a one-page PDF brief.
5. **Checks.** Eleven deterministic validators run after every change; failures name the tool that fixes them and can be repaired with one click.
6. **Feedback that acts.** 👍/👎 on any publisher, creative, config or interpretation; a 👎 with a comment re-runs only the affected tool.
7. **Memory.** Brand voice, banned publishers, default budget/bid strategy (preferences) and free-text facts — set explicitly or from chat ("never use Swiftcart"); always visible and deletable.
8. **Credits.** 100 on signup. Each model-touching action costs a base fee plus 1 credit per 4k weighted tokens (gpt-4.1 counts 2×). Deterministic edits, exports and compare are free. Every charge is a ledger row tied to an interaction.
9. **Chat as an alternate full workflow** over the same tools, and **History + Compare** across runs and versions.

## Architecture in one paragraph

One codebase, two deployment shapes. **Shape A** (demo, Railway free tier): FastAPI serves the Next.js static export and the API from one container. **Shape B** (scale): Vercel serves the frontend, Railway the backend, `NEXT_PUBLIC_API_URL` is the only switch. Supabase provides Auth (email + Google) and Postgres (RLS on every table); OpenAI provides `gpt-4.1-mini` for scoring/clarity/personas/config and `gpt-4.1` for creative and the chat planner. The backend is an **agent core**: an orchestrator (guided · free · repair modes) that only calls typed tools, runs validators, charges credits from real usage, and persists a version per interaction. Details and diagrams: [`docs/design/HLD.md`](docs/design/HLD.md), [`docs/design/LLD.md`](docs/design/LLD.md).

## Repository layout

```
data/                 publishers.json · shopper_personas.json · example_advertisers.txt (the mock data pack)
design/prototype/     clickable prototype — index.html + assets/ (no build step)
design/review/        screenshots and automated audit report of the prototype
docs/design/          HLD.md · LLD.md · rendered HTML versions
docs/                 ASSIGNMENT.md (original brief) · GLOSSARY.md at repo root
tools/                review_prototype.py (screenshot + lint) · smoke_prototype.py (drives the flows)
backend/  frontend/  prompts/     ← next commits
```

## Running the prototype and its review

```bash
# open the prototype
xdg-open design/prototype/index.html        # or any static server; demo login is pre-filled, 100 credits on signup

# review tooling (Python 3.12 + uv)
uv venv .venv && uv pip install -r tools/requirements.txt && .venv/bin/python -m playwright install chromium
.venv/bin/python tools/review_prototype.py design/prototype/index.html --out design/review
.venv/bin/python tools/smoke_prototype.py  design/prototype/index.html
```

Both tools exit non-zero on failure so they can gate CI. Current state: 0 errors, 0 warnings across 56 screenshots; smoke test green.

## Next: implementation plan (6–8 h)

1. Backend skeleton + deterministic `scoring.py` with golden tests
2. Agent core: registry, tools, validators, memory, credits; prompts in `prompts/`
3. Frontend: login, wizard, campaign tabs, history, memory, credits (shadcn/ui)
4. Chat + feedback + PDF export
5. Dockerfile (Shape A) on Railway, Vercel project (Shape B), one-page submission README

## Configuration

Copy `.env.example` to `.env`. Secrets are never committed; the prompt files in `prompts/` will contain no keys.
