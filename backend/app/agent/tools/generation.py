"""The five generation tools. Each is small: format inputs, call the LLM (or pure Python), merge, validate ids."""
from __future__ import annotations

import json
import math
import time
from datetime import date, timedelta

from pydantic import BaseModel, Field

from ...llm import client as llm
from ...schemas.domain import (Allocation, Bid, Budget, CampaignConfig, ClarityQuestion, ClarityResult, Creative, ExcludedPublisher, Flight,
                               ParsedBrief, PersonaPick, PublisherScore, SkippedPersona, Targeting)
from ...services import scoring
from ..registry import AgentCtx, Cost, Tool, register

MAX_LLM_DELTA = 15
EXCLUDE_BELOW = 40
ALLOC_CAP = 45


# ============================================================================ clarity
class ClarityIn(BaseModel):
    brief: str = Field(description="The advertiser's business description, verbatim")
    answers: list[str] = Field(default_factory=list, description="Answers to previously asked clarifying questions, in order")


class ClarityOut(BaseModel):
    analysis: str = Field(description="Step 1 reasoning, 2-4 sentences")
    score: int = Field(ge=0, le=100)
    label: str
    summary: str
    signals: list[str]
    missing: list[str]
    questions: list[ClarityQuestion]
    parsed_brief: ParsedBrief


@register
class ScoreClarity(Tool[ClarityIn, ClarityResult]):
    name = "score_clarity"
    description = "Score how clear an advertiser brief is (0-100), extract product/buyer/price/model, and return clarifying questions when it is vague. Free."
    Input, Output = ClarityIn, ClarityResult
    cost = Cost.free()

    async def run(self, ctx: AgentCtx, inp: ClarityIn) -> ClarityResult:
        t0 = time.perf_counter()
        answers = "\nThe advertiser answered these clarifying questions, in order:\n" + "\n".join(f"- {a}" for a in inp.answers) if inp.answers else ""
        cats = sorted({t for p in ctx.catalog.publishers for t in p.tags} | {a for p in ctx.catalog.personas for a in p.category_affinities})
        out, usage = await llm.structured("clarity", ClarityOut, tool=self.name, brief=inp.brief, answers=answers,
                                          catalog_categories=", ".join(cats), memory=ctx.memory.render(ctx.publisher_names()))
        ctx.usage.add(usage)
        score = int(out.score)
        if inp.answers and score < 60:
            score = max(score, 65)  # answered questions always unlock generation; the summary says "Interpreted as:"
        label = "Vague" if score < 60 else "Usable" if score < 80 else "Clear"
        questions = []
        if score < 60:
            for q in out.questions[:3]:
                opts = [o for o in q.opts if o.strip().lower() not in ("other", "other (please specify)", "something else")][:5]
                if len(opts) >= 2:
                    questions.append(ClarityQuestion(q=q.q, opts=opts, multi=bool(q.multi)))
        await ctx.stage("Parsing brief", "done", f"clarity {score}", int((time.perf_counter() - t0) * 1000))
        return ClarityResult(score=score, label=label, summary=out.summary, signals=out.signals[:5], missing=out.missing, questions=questions,
                             parsed_brief=out.parsed_brief, answers=inp.answers)


# ============================================================================ prescore
class PrescoreIn(BaseModel):
    pass


class PrescoreOut(BaseModel):
    scores: list[PublisherScore]


@register
class PrescorePublishers(Tool[PrescoreIn, PrescoreOut]):
    name = "prescore_publishers"
    description = "Deterministic 0-100 pre-score of all 20 publishers for the current brief. Free, no model call."
    Input, Output = PrescoreIn, PrescoreOut
    chat_exposed = False

    async def run(self, ctx: AgentCtx, inp: PrescoreIn) -> PrescoreOut:
        assert ctx.campaign
        return PrescoreOut(scores=scoring.prescore(ctx.campaign.parsed_brief, ctx.catalog))


# ============================================================================ rank
class RankIn(BaseModel):
    focus_publisher_id: str | None = Field(default=None, description="Re-evaluate only this publisher (feedback repair)")
    instruction: str | None = Field(default=None, description="Extra guidance from the user, e.g. feedback comment")


class _Adjust(BaseModel):
    id: str
    delta: int = Field(ge=-MAX_LLM_DELTA, le=MAX_LLM_DELTA)
    reason: str
    recommend: bool


class _Excl(BaseModel):
    id: str
    reason: str


class RankOut(BaseModel):
    analysis: str = Field(description="Step 1 reasoning, 3-5 sentences")
    adjustments: list[_Adjust]
    exclusions: list[_Excl]


class RankResult(BaseModel):
    publishers: list[PublisherScore]
    excluded: list[ExcludedPublisher]


@register
class RankPublishers(Tool[RankIn, RankResult]):
    name = "rank_publishers"
    description = "Rank publishers for the current campaign: deterministic pre-score plus a bounded model adjustment with a written reason per publisher, and reasoned exclusions. Costs credits."
    Input, Output = RankIn, RankResult
    cost = Cost(0, True)
    mutates = True

    async def run(self, ctx: AgentCtx, inp: RankIn) -> RankResult:
        assert ctx.campaign
        t0 = time.perf_counter()
        cat = ctx.catalog
        pre = scoring.prescore(ctx.campaign.parsed_brief, cat)
        top = pre[:10]
        by_id = {s.id: s for s in pre}
        cands = []
        for s in top:
            p = cat.publisher(s.id)
            cands.append({"id": p.id, "name": p.name, "category": p.category, "subcategories": p.subcategories, "audience": p.audience.model_dump(),
                          "aov_usd": p.avg_order_value_usd, "monthly_impressions": p.monthly_impressions, "prescore": s.score, "breakdown": s.bd.model_dump(), "note": p.notes})
        summary = ctx.campaign.clarity.summary
        if inp.instruction:
            summary += f"\nAdvertiser feedback to apply: {inp.instruction}"
        if inp.focus_publisher_id:
            summary += f"\nRe-evaluate publisher {inp.focus_publisher_id} in light of the feedback; keep the others' deltas at 0."
        top_ids = {s.id for s in top}
        others = "\n".join(f"{p.id} · {p.name} · {p.category} · {p.audience.age_skew} · AOV ${p.avg_order_value_usd} · {p.notes}" for p in cat.publishers if p.id not in top_ids)
        out, usage = await llm.structured("rank", RankOut, tool=self.name, brief_summary=summary, parsed_brief=ctx.campaign.parsed_brief.model_dump_json(),
                                          candidates=json.dumps(cands, ensure_ascii=False), others=others or "(none)", memory=ctx.memory.render(ctx.publisher_names()))
        ctx.usage.add(usage)

        banned = set(ctx.memory.preferences.get("banned_publishers") or [])
        recommended: list[PublisherScore] = []
        excluded: list[ExcludedPublisher] = []
        seen: set[str] = set()
        for adj in out.adjustments:
            if adj.id not in by_id or adj.id in seen:
                continue
            seen.add(adj.id)
            s = by_id[adj.id]
            delta = max(-MAX_LLM_DELTA, min(MAX_LLM_DELTA, adj.delta))
            final = max(0, min(100, s.prescore + delta))
            reason = adj.reason.strip() or f"Pre-score {s.prescore} from category, persona, AOV and audience fit."
            recommend = adj.recommend or final >= 60
            if recommend and final >= EXCLUDE_BELOW and adj.id not in banned:
                recommended.append(PublisherScore(id=s.id, score=final, prescore=s.prescore, llm_delta=delta, bd=s.bd, why=reason))
            else:
                why = "On your banned publishers list." if adj.id in banned else reason
                excluded.append(ExcludedPublisher(id=s.id, score=final, why=why))
        for ex in out.exclusions:
            if ex.id in by_id and ex.id not in seen:
                seen.add(ex.id)
                excluded.append(ExcludedPublisher(id=ex.id, score=by_id[ex.id].score, why=ex.reason.strip()))
        recommended.sort(key=lambda s: -s.score)
        # A plan needs ≥3 placements to produce signal: top up from the next-best candidates (≥40) as capped reach tests,
        # and never return nothing even for an off-category brief.
        if len(recommended) < 3:
            # Candidates ≥40 first; then, so a plan always has 3 placements, the best remaining pre-scored publishers as honest weak fits.
            pool = sorted((e for e in excluded if e.id not in banned and e.score >= EXCLUDE_BELOW), key=lambda e: -e.score)
            used = {p.id for p in recommended} | {e.id for e in pool}
            pool += [ExcludedPublisher(id=s.id, score=s.score, why="Weak fit: nothing in this consumer-commerce catalog matches well; kept as the least-bad reach option.")
                     for s in pre if s.id not in used and s.id not in banned]
            for e in pool:
                if len(recommended) >= 3:
                    break
                s = by_id[e.id]
                why = e.why if e.why.lower().startswith(("weak fit", "reach test")) else f"Reach test (capped): {e.why}"
                recommended.append(PublisherScore(id=s.id, score=e.score, prescore=s.prescore, llm_delta=e.score - s.prescore, bd=s.bd, why=why))
                excluded = [x for x in excluded if x.id != e.id]
            recommended.sort(key=lambda s: -s.score)
        recommended = recommended[:5]
        excluded.sort(key=lambda e: -e.score)
        await ctx.stage("Scoring 20 publishers", "done", f"{len(recommended)} recommended", int((time.perf_counter() - t0) * 1000))
        return RankResult(publishers=recommended, excluded=excluded[:6])


# ============================================================================ personas
class PersonasIn(BaseModel):
    exclude_persona_ids: list[str] = Field(default_factory=list, description="Personas the user rejected")
    instruction: str | None = None


class _Pick(BaseModel):
    id: str
    fit: int = Field(ge=0, le=100)
    why: str


class _Skip(BaseModel):
    id: str
    why: str


class PersonasOut(BaseModel):
    analysis: str = Field(description="Step 1 reasoning")
    chosen: list[_Pick]
    skipped: list[_Skip]


class PersonasResult(BaseModel):
    personas: list[PersonaPick]
    skipped: list[SkippedPersona]


@register
class PickPersonas(Tool[PersonasIn, PersonasResult]):
    name = "pick_personas"
    description = "Choose 3-5 shopper personas for the current campaign with fit scores and reasons. Costs credits."
    Input, Output = PersonasIn, PersonasResult
    cost = Cost(0, True)
    mutates = True

    async def run(self, ctx: AgentCtx, inp: PersonasIn) -> PersonasResult:
        assert ctx.campaign
        t0 = time.perf_counter()
        cat = ctx.catalog
        pers = [p.model_dump() for p in cat.personas if p.id not in inp.exclude_persona_ids]
        rec = [{"name": cat.publisher(p.id).name, "score": p.score, "audience": cat.publisher(p.id).audience.model_dump()} for p in ctx.campaign.publishers]
        summary = ctx.campaign.clarity.summary + (f"\nAdvertiser feedback: {inp.instruction}" if inp.instruction else "")
        out, usage = await llm.structured("personas", PersonasOut, tool=self.name, brief_summary=summary, parsed_brief=ctx.campaign.parsed_brief.model_dump_json(),
                                          personas=json.dumps(pers, ensure_ascii=False), recommended=json.dumps(rec), memory=ctx.memory.render(ctx.publisher_names()))
        ctx.usage.add(usage)
        chosen: list[PersonaPick] = []
        seen: set[str] = set()
        for c in out.chosen:
            if cat.has_persona(c.id) and c.id not in seen and c.id not in inp.exclude_persona_ids:
                seen.add(c.id)
                chosen.append(PersonaPick(id=c.id, fit=c.fit, why=c.why.strip()))
        chosen.sort(key=lambda p: -p.fit)
        chosen = chosen[:5]
        if len(chosen) < 3:  # top up deterministically so creative always has ≥3 targets
            for p in cat.personas:
                if len(chosen) >= 3:
                    break
                if p.id not in seen and p.id not in inp.exclude_persona_ids:
                    chosen.append(PersonaPick(id=p.id, fit=40, why="Added to reach the minimum of three personas; fit estimated from category affinities."))
                    seen.add(p.id)
        skipped = [SkippedPersona(id=s.id, why=s.why.strip()) for s in out.skipped if cat.has_persona(s.id) and s.id not in seen][:3]
        await ctx.stage("Selecting personas", "done", f"{len(chosen)} of 10", int((time.perf_counter() - t0) * 1000))
        return PersonasResult(personas=chosen, skipped=skipped)


# ============================================================================ creatives
class CreativesIn(BaseModel):
    persona_ids: list[str] | None = Field(default=None, description="Subset to (re)write; default all chosen personas")
    instruction: str | None = Field(default=None, description="User guidance, e.g. 'too clinical, make it warmer'")
    avoid_headlines: list[str] = Field(default_factory=list, description="Previous headlines that must not be repeated")


class _Cr(BaseModel):
    persona_id: str
    headline: str
    body: str
    cta: str
    rationale: str
    assumptions: list[str] = Field(default_factory=list)


class CreativesOut(BaseModel):
    analysis: str = Field(description="Step 1: facts available in the brief and the angle per persona")
    creatives: list[_Cr]


class CreativesResult(BaseModel):
    creatives: list[Creative]


@register
class WriteCreatives(Tool[CreativesIn, CreativesResult]):
    name = "write_creatives"
    description = "Write one ad creative (headline, body, CTA) per chosen persona. Uses the strong model; costs credits."
    Input, Output = CreativesIn, CreativesResult
    cost = Cost(0, True)
    mutates = True
    chat_exposed = False  # chat uses regenerate_creative for single variants

    async def run(self, ctx: AgentCtx, inp: CreativesIn) -> CreativesResult:
        assert ctx.campaign
        t0 = time.perf_counter()
        cat = ctx.catalog
        ids = inp.persona_ids or [p.id for p in ctx.campaign.personas]
        blocks = []
        for pk in ctx.campaign.personas:
            if pk.id not in ids:
                continue
            p = cat.persona(pk.id)
            blocks.append(f"### {p.id} — {p.name} (fit {pk.fit})\n{p.description}\nWhy chosen: {pk.why}\nPreferences: {', '.join(p.messaging_preferences)}\n"
                          f"Disinterests: {', '.join(p.disinterested_in)}\nPrice sensitivity: {p.price_sensitivity}")
        instruction = f"\nAdvertiser instruction (must be applied): {inp.instruction}" if inp.instruction else ""
        avoid = ("\nDo not reuse these headlines or their structure: " + " | ".join(inp.avoid_headlines)) if inp.avoid_headlines else ""
        out, usage = await llm.structured("creative", CreativesOut, tool=self.name, brief_summary=ctx.campaign.clarity.summary,
                                          parsed_brief=ctx.campaign.parsed_brief.model_dump_json(), personas="\n\n".join(blocks),
                                          memory=ctx.memory.render(ctx.publisher_names()), instruction=instruction, avoid=avoid)
        ctx.usage.add(usage)
        wanted = set(ids)
        creatives: list[Creative] = []
        for c in out.creatives:
            if c.persona_id in wanted and not any(x.persona_id == c.persona_id for x in creatives):
                creatives.append(Creative(persona_id=c.persona_id, headline=_fit(_no_emdash(c.headline), 80), body=_fit_body(_no_emdash(c.body)), cta=_fit(c.cta, 24),
                                          rationale=c.rationale.strip(), assumptions=[a.strip() for a in c.assumptions if a.strip()][:3]))
        await ctx.stage("Writing creative", "done", f"{len(creatives)} variants", int((time.perf_counter() - t0) * 1000))
        return CreativesResult(creatives=creatives)


def _no_emdash(text: str) -> str:
    """House style: no em dashes in ad copy (the prompt forbids them; this is the guard)."""
    return text.replace(" — ", ", ").replace("—", ", ").replace(" – ", ", ").replace("–", "-")


def _fit(text: str, limit: int) -> str:
    """Trim at a word boundary to the character limit (the model usually complies; this is the guard)."""
    t = " ".join(text.split())
    if len(t) <= limit:
        return t
    cut = t[:limit].rsplit(" ", 1)[0].rstrip(",;:-— ")
    return cut if len(cut) > limit // 2 else t[:limit].rstrip()


def _fit_body(text: str) -> str:
    """Bodies must be 60–240 chars: trim at the last sentence end that fits, else at a word boundary."""
    t = " ".join(text.split())
    if len(t) <= 240:
        return t
    head = t[:240]
    for sep in (". ", "! ", "? "):
        i = head.rfind(sep)
        if i >= 60:
            return head[: i + 1]
    return _fit(t, 240)


# ============================================================================ config
class ConfigIn(BaseModel):
    instruction: str | None = None


class ConfigNoteOut(BaseModel):
    analysis: str = Field(description="Step 1 reasoning")
    objective: str
    bid_strategy: str
    primary_kpi: str
    rationale: str


class ConfigResult(BaseModel):
    config: CampaignConfig


OBJECTIVES = {"purchase", "subscription_signup", "trial_start", "lead", "traffic"}
STRATEGIES = {"target_cpa", "max_conversions_with_cpa_cap", "manual_cpm", "manual_cpc", "max_clicks"}


def allocate(publishers: list[PublisherScore], catalog, cap: int = ALLOC_CAP) -> list[Allocation]:
    """Split follows fit × log(reach), capped per publisher, normalised to exactly 100."""
    if not publishers:
        return []
    cap = max(cap, math.ceil(100 / len(publishers)))  # two publishers can only ever be capped at 50
    raw = {p.id: p.score * math.log10(max(catalog.publisher(p.id).monthly_impressions, 10)) for p in publishers}
    total = sum(raw.values())
    pct = {k: v / total * 100 for k, v in raw.items()}
    if len(pct) > 1:
        for _ in range(5):  # iterative cap: push excess to the others proportionally
            over = {k: v - cap for k, v in pct.items() if v > cap}
            if not over:
                break
            excess = sum(over.values())
            for k in over:
                pct[k] = cap
            under = [k for k in pct if k not in over]
            share = sum(pct[k] for k in under) or 1
            for k in under:
                pct[k] += excess * pct[k] / share
    ints = {k: int(round(v)) for k, v in pct.items()}
    drift = 100 - sum(ints.values())
    ints[max(ints, key=ints.get)] += drift
    return [Allocation(publisher_id=k, pct=v) for k, v in ints.items()]


def default_budget(brief: ParsedBrief, memory_daily: int | None) -> tuple[int, int]:
    daily = memory_daily or {"budget": 150, "mid": 250, "premium": 400, "luxury": 600, "unknown": 250}[brief.price_tier]
    return daily, daily * 30


@register
class BuildConfig(Tool[ConfigIn, ConfigResult]):
    name = "build_config"
    description = "Assemble the campaign config: objective, bid strategy with rationale, budget, flight, targeting and per-publisher allocation. Costs credits (small)."
    Input, Output = ConfigIn, ConfigResult
    cost = Cost(0, True)
    mutates = True

    async def run(self, ctx: AgentCtx, inp: ConfigIn) -> ConfigResult:
        c = ctx.campaign
        assert c
        t0 = time.perf_counter()
        cat = ctx.catalog
        rec = [{"name": cat.publisher(p.id).name, "score": p.score, "aov_usd": cat.publisher(p.id).avg_order_value_usd} for p in c.publishers]
        pers = [{"name": cat.persona(p.id).name, "fit": p.fit} for p in c.personas]
        summary = c.clarity.summary + (f"\nAdvertiser instruction: {inp.instruction}" if inp.instruction else "")
        out, usage = await llm.structured("config_note", ConfigNoteOut, tool=self.name, brief_summary=summary, parsed_brief=c.parsed_brief.model_dump_json(),
                                          recommended=json.dumps(rec), personas=json.dumps(pers), memory=ctx.memory.render(ctx.publisher_names()))
        ctx.usage.add(usage)
        objective = out.objective if out.objective in OBJECTIVES else "purchase"
        strategy = ctx.memory.preferences.get("bid_strategy_default") or (out.bid_strategy if out.bid_strategy in STRATEGIES else "target_cpa")
        daily, total = default_budget(c.parsed_brief, ctx.memory.preferences.get("default_daily_budget"))
        start = date.today().replace(day=1) + timedelta(days=32)
        start = start.replace(day=1)
        end = start + timedelta(days=29)
        # CPM/CPC ranges follow the recommended publishers' AOV band (higher AOV → pricier inventory).
        aovs = [cat.publisher(p.id).avg_order_value_usd for p in c.publishers] or [60]
        mid = sum(aovs) / len(aovs)
        cpm_lo, cpm_hi = (10, 18) if mid < 50 else (14, 22) if mid < 100 else (18, 28)
        cpc_lo, cpc_hi = (0.6, 1.2) if mid < 50 else (1.1, 1.9) if mid < 100 else (1.6, 2.8)
        # Targeting derived from chosen personas and recommended publishers.
        ages = [cat.persona(p.id).age_band for p in c.personas] or [(25, 45)]
        age_range = f"{min(a for a, _ in ages)}–{max(b for _, b in ages)}"
        shares = [cat.publisher(p.id).female_share for p in c.publishers] or [0.5]
        f = sum(shares) / len(shares)
        gender = "Women" if f > 0.85 else "Men" if f < 0.25 else f"All (skews {round(f * 100)}% F)"
        geos = sorted({g for p in c.publishers for g in cat.publisher(p.id).audience.top_geos})
        income = sorted({cat.publisher(p.id).audience.income_tier for p in c.publishers})
        interests = [t for t in c.parsed_brief.categories][:5]
        exclude = ["ultra-cheap positioning contexts"] if c.parsed_brief.price_tier in ("premium", "luxury") else ["luxury-only contexts"] if c.parsed_brief.price_tier == "budget" else []
        cfg = CampaignConfig(objective=objective, primary_kpi=out.primary_kpi.strip(),
                             bid=Bid(strategy=strategy, cpm_range_usd=f"${cpm_lo}–${cpm_hi}", cpc_range_usd=f"${cpc_lo:.2f}–${cpc_hi:.2f}", rationale=out.rationale.strip()),
                             budget=Budget(daily_usd=daily, total_usd=total), flight=Flight(start=start.isoformat(), end=end.isoformat()),
                             targeting=Targeting(age_range=age_range, gender=gender, income_tiers=income, geos=geos, interests=interests, exclude_contexts=exclude),
                             allocation=allocate(c.publishers, cat))
        await ctx.stage("Assembling config", "done", f"{strategy} · ${total:,}", int((time.perf_counter() - t0) * 1000))
        return ConfigResult(config=cfg)
