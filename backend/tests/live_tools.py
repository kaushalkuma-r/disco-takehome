"""Manual live run of the generation tools against OpenAI (not collected by pytest). python tests/live_tools.py [brief]"""
import asyncio, sys, time, uuid
from datetime import datetime, timezone
from app.agent.memory import MemoryBlock
from app.agent.registry import AgentCtx, UserCtx, get
from app.agent.tools import generation  # noqa: F401 (registers)
from app.catalog import load_catalog
from app.schemas.domain import Campaign, ParsedBrief
from app.billing.pricing import tokens_to_credits
from app.agent.validators import run_all

async def main(brief: str, answers: list[str]):
    cat = load_catalog(); ctx = AgentCtx(user=UserCtx(uuid.uuid4(), "x@y.z", "X"), thread_id=None, interaction_id=None, catalog=cat, memory=MemoryBlock(),
                                          emit=lambda e: print(f"  [{e.status}] {e.stage} — {e.detail} ({e.ms} ms)"))
    t0 = time.perf_counter()
    clar = await get("score_clarity")().run(ctx, get("score_clarity").Input(brief=brief, answers=answers))
    print("CLARITY", clar.score, clar.label, "|", clar.summary); print("  signals", clar.signals); print("  parsed", clar.parsed_brief.model_dump())
    if clar.questions: print("  QUESTIONS", [q.model_dump() for q in clar.questions])
    if clar.score < 60 and not answers: return
    now = datetime.now(timezone.utc)
    ctx.campaign = Campaign(id=uuid.uuid4(), user_id=ctx.user.id, name="t", brief=brief, clarity=clar, parsed_brief=clar.parsed_brief, created_at=now, updated_at=now)
    r = await get("rank_publishers")().run(ctx, get("rank_publishers").Input())
    ctx.campaign.publishers, ctx.campaign.excluded = r.publishers, r.excluded
    for p in r.publishers: print(f"  REC {cat.publisher(p.id).name:14} {p.score:3} (pre {p.prescore}, Δ{p.llm_delta:+}) {p.why}")
    for e in r.excluded: print(f"  EXC {cat.publisher(e.id).name:14} {e.score:3} {e.why}")
    pr = await get("pick_personas")().run(ctx, get("pick_personas").Input()); ctx.campaign.personas, ctx.campaign.skipped_personas = pr.personas, pr.skipped
    for p in pr.personas: print(f"  PER {cat.persona(p.id).name:30} {p.fit} {p.why}")
    cr = await get("write_creatives")().run(ctx, get("write_creatives").Input()); ctx.campaign.creatives = cr.creatives
    for c in cr.creatives: print(f"  CRE {cat.persona(c.persona_id).name}: {c.headline!r} / {c.body!r} / {c.cta!r}")
    cf = await get("build_config")().run(ctx, get("build_config").Input()); ctx.campaign.config = cf.config
    print("  CFG", cf.config.objective, cf.config.bid.strategy, cf.config.primary_kpi, cf.config.budget.model_dump(), [(a.publisher_id, a.pct) for a in cf.config.allocation])
    print("  WHY", cf.config.bid.rationale)
    v = run_all(ctx.campaign, cat, ctx.memory); print("  CHECKS", [(x.check, x.message) for x in v if not x.passed] or "all pass")
    print(f"TOKENS {ctx.usage.total_tokens} ({ctx.usage.mix()}) → usage credits {tokens_to_credits(ctx.usage)} | {time.perf_counter()-t0:.1f}s")

if __name__ == "__main__":
    brief = sys.argv[1] if len(sys.argv) > 1 else "We sell premium dog food for senior dogs, targeting owners who care about joint health and longevity. Grain-free, vet-formulated, subscription-based."
    asyncio.run(main(brief, sys.argv[2:]))
