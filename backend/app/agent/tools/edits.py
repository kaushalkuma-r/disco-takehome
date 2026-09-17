"""Deterministic edit tools (free) plus regenerate_creative, memory tools and export. All operate on ctx.campaign."""
from __future__ import annotations

from pydantic import BaseModel, Field

from ... import repo
from ...schemas.domain import Allocation, Campaign, ExcludedPublisher, PersonaPick
from ..registry import AgentCtx, Cost, Tool, register
from .generation import CreativesIn, WriteCreatives, allocate


class CampaignOut(BaseModel):
    ok: bool = True
    note: str = ""


def _renormalise(c: Campaign) -> None:
    if not c.config:
        return
    rec = {p.id for p in c.publishers}
    keep = [a for a in c.config.allocation if a.publisher_id in rec]
    total = sum(a.pct for a in keep)
    if not keep:
        c.config.allocation = []
        return
    if total <= 0:
        c.config.allocation = allocate(c.publishers, None) if False else [Allocation(publisher_id=a.publisher_id, pct=100 // len(keep)) for a in keep]
    else:
        for a in keep:
            a.pct = round(a.pct / total * 100)
    drift = 100 - sum(a.pct for a in keep)
    keep[0].pct += drift
    c.config.allocation = keep


# ----------------------------------------------------------------------------- drop_publisher
class DropIn(BaseModel):
    publisher_id: str = Field(description="Catalog publisher id, e.g. pub_001")
    reason: str | None = Field(default=None, description="Why it is being removed (shown in the exclusions list)")


@register
class DropPublisher(Tool[DropIn, CampaignOut]):
    name = "drop_publisher"
    description = "Remove a publisher from the plan and re-spread its budget across the rest. Free."
    Input, Output = DropIn, CampaignOut
    mutates = True

    async def run(self, ctx: AgentCtx, inp: DropIn) -> CampaignOut:
        c = ctx.campaign
        assert c
        if not any(p.id == inp.publisher_id for p in c.publishers):
            return CampaignOut(ok=False, note=f"{inp.publisher_id} is not in the plan")
        c.publishers = [p for p in c.publishers if p.id != inp.publisher_id]
        c.excluded.insert(0, ExcludedPublisher(id=inp.publisher_id, score=0, why=inp.reason or f"Removed by {ctx.user.name or 'the advertiser'}."))
        _renormalise(c)
        return CampaignOut(note=f"Dropped {ctx.catalog.publisher(inp.publisher_id).name}")


# ----------------------------------------------------------------------------- set_budget
class BudgetIn(BaseModel):
    total_usd: int | None = Field(default=None, ge=0)
    daily_usd: int | None = Field(default=None, ge=0)
    flight_start: str | None = Field(default=None, description="ISO date")
    flight_end: str | None = Field(default=None, description="ISO date")


@register
class SetBudget(Tool[BudgetIn, CampaignOut]):
    name = "set_budget"
    description = "Change the total or daily budget and/or flight dates. Keeps daily×days ≈ total. Free."
    Input, Output = BudgetIn, CampaignOut
    mutates = True

    async def run(self, ctx: AgentCtx, inp: BudgetIn) -> CampaignOut:
        c = ctx.campaign
        assert c and c.config
        from datetime import date
        if inp.flight_start:
            c.config.flight.start = inp.flight_start
        if inp.flight_end:
            c.config.flight.end = inp.flight_end
        days = max(1, (date.fromisoformat(c.config.flight.end) - date.fromisoformat(c.config.flight.start)).days)
        if inp.total_usd is not None:
            c.config.budget.total_usd = inp.total_usd
            c.config.budget.daily_usd = round(inp.total_usd / days)
        elif inp.daily_usd is not None:
            c.config.budget.daily_usd = inp.daily_usd
            c.config.budget.total_usd = inp.daily_usd * days
        else:
            c.config.budget.total_usd = c.config.budget.daily_usd * days
        return CampaignOut(note=f"Budget ${c.config.budget.total_usd:,} total, ${c.config.budget.daily_usd:,}/day")


# ----------------------------------------------------------------------------- update_creative
class UpdateCreativeIn(BaseModel):
    persona_id: str
    headline: str | None = Field(default=None, max_length=120)
    body: str | None = Field(default=None, max_length=400)
    cta: str | None = Field(default=None, max_length=40)


@register
class UpdateCreative(Tool[UpdateCreativeIn, CampaignOut]):
    name = "update_creative"
    description = "Manually edit one creative's headline, body or CTA. Free."
    Input, Output = UpdateCreativeIn, CampaignOut
    mutates = True

    async def run(self, ctx: AgentCtx, inp: UpdateCreativeIn) -> CampaignOut:
        c = ctx.campaign
        assert c
        cr = next((x for x in c.creatives if x.persona_id == inp.persona_id), None)
        if not cr:
            return CampaignOut(ok=False, note="no creative for that persona")
        if inp.headline is not None:
            cr.headline = inp.headline.strip()
        if inp.body is not None:
            cr.body = inp.body.strip()
        if inp.cta is not None:
            cr.cta = inp.cta.strip()
        return CampaignOut(note=f"Edited creative for {ctx.catalog.persona(inp.persona_id).name}")


# ----------------------------------------------------------------------------- set_config (form save)
class SetConfigIn(BaseModel):
    objective: str | None = None
    primary_kpi: str | None = None
    bid_strategy: str | None = None
    cpm_range_usd: str | None = None
    cpc_range_usd: str | None = None
    budget_daily_usd: int | None = None
    budget_total_usd: int | None = None
    flight_start: str | None = None
    flight_end: str | None = None
    age_range: str | None = None
    gender: str | None = None
    income_tiers: list[str] | None = None
    allocation: list[Allocation] | None = None


@register
class SetConfig(Tool[SetConfigIn, CampaignOut]):
    name = "set_config"
    description = "Apply edited config fields from the config form. Free."
    Input, Output = SetConfigIn, CampaignOut
    mutates = True
    chat_exposed = False

    async def run(self, ctx: AgentCtx, inp: SetConfigIn) -> CampaignOut:
        c = ctx.campaign
        assert c and c.config
        k = c.config
        for src, dst in [("objective", "objective"), ("primary_kpi", "primary_kpi")]:
            v = getattr(inp, src)
            if v is not None:
                setattr(k, dst, v)
        if inp.bid_strategy:
            k.bid.strategy = inp.bid_strategy  # type: ignore[assignment]
        if inp.cpm_range_usd:
            k.bid.cpm_range_usd = inp.cpm_range_usd
        if inp.cpc_range_usd:
            k.bid.cpc_range_usd = inp.cpc_range_usd
        if inp.budget_daily_usd is not None:
            k.budget.daily_usd = inp.budget_daily_usd
        if inp.budget_total_usd is not None:
            k.budget.total_usd = inp.budget_total_usd
        if inp.flight_start:
            k.flight.start = inp.flight_start
        if inp.flight_end:
            k.flight.end = inp.flight_end
        if inp.age_range:
            k.targeting.age_range = inp.age_range
        if inp.gender:
            k.targeting.gender = inp.gender
        if inp.income_tiers is not None:
            k.targeting.income_tiers = inp.income_tiers
        if inp.allocation is not None:
            k.allocation = inp.allocation
        return CampaignOut(note="Config saved")


# ----------------------------------------------------------------------------- add_persona / regenerate_creative
class AddPersonaIn(BaseModel):
    persona_id: str


@register
class AddPersona(Tool[AddPersonaIn, CampaignOut]):
    name = "add_persona"
    description = "Add a persona to the campaign with a placeholder creative (regenerate to write real copy). Free."
    Input, Output = AddPersonaIn, CampaignOut
    mutates = True
    chat_exposed = False

    async def run(self, ctx: AgentCtx, inp: AddPersonaIn) -> CampaignOut:
        c = ctx.campaign
        assert c
        if any(p.id == inp.persona_id for p in c.personas):
            return CampaignOut(ok=False, note="already in the campaign")
        P = ctx.catalog.persona(inp.persona_id)
        c.personas.append(PersonaPick(id=P.id, fit=45, why="Added manually. Fit is estimated from category affinities only."))
        c.skipped_personas = [s for s in c.skipped_personas if s.id != P.id]
        from ...schemas.domain import Creative
        c.creatives.append(Creative(persona_id=P.id, headline=f"Made for {P.name.replace('The ', 'the ').lower()}.",
                                    body=f"{', '.join(P.messaging_preferences[:2])} — because that is what you actually weigh up before you buy.", cta="Learn more",
                                    rationale="Placeholder until regenerated."))
        return CampaignOut(note=f"Added {P.name}")


class RegenIn(BaseModel):
    persona_id: str = Field(description="Persona whose creative to rewrite")
    instruction: str | None = Field(default=None, description="What to change, e.g. 'too clinical, make it warmer'")


@register
class RegenerateCreative(Tool[RegenIn, CampaignOut]):
    name = "regenerate_creative"
    description = "Rewrite one persona's creative, optionally following an instruction. Costs credits (base 2 + usage)."
    Input, Output = RegenIn, CampaignOut
    cost = Cost(2, True)
    mutates = True

    async def run(self, ctx: AgentCtx, inp: RegenIn) -> CampaignOut:
        c = ctx.campaign
        assert c
        if not any(p.id == inp.persona_id for p in c.personas):
            return CampaignOut(ok=False, note="persona not in campaign")
        old = next((x for x in c.creatives if x.persona_id == inp.persona_id), None)
        res = await WriteCreatives().run(ctx, CreativesIn(persona_ids=[inp.persona_id], instruction=inp.instruction, avoid_headlines=[old.headline] if old else []))
        if not res.creatives:
            return CampaignOut(ok=False, note="model returned no creative")
        new = res.creatives[0]
        c.creatives = [new if x.persona_id == inp.persona_id else x for x in c.creatives] if old else [*c.creatives, new]
        return CampaignOut(note=f"Rewrote creative for {ctx.catalog.persona(inp.persona_id).name}")


# ----------------------------------------------------------------------------- memory tools
class SavePrefIn(BaseModel):
    key: str = Field(description="One of: brand_voice, banned_publishers, banned_words, default_daily_budget, bid_strategy_default")
    value: str | int | list[str] = Field(description="Value; lists for banned_publishers (publisher ids) and banned_words")


@register
class SavePreference(Tool[SavePrefIn, CampaignOut]):
    name = "save_preference"
    description = "Save a durable advertiser preference (brand voice, banned publishers, default budget/bid strategy). Free."
    Input, Output = SavePrefIn, CampaignOut

    async def run(self, ctx: AgentCtx, inp: SavePrefIn) -> CampaignOut:
        key = inp.key.strip().lower().replace(" ", "_")
        aliases = {"banned_publisher": "banned_publishers", "ban_publishers": "banned_publishers", "excluded_publishers": "banned_publishers",
                   "never_use_publishers": "banned_publishers", "banned_word": "banned_words", "voice": "brand_voice", "tone": "brand_voice",
                   "daily_budget": "default_daily_budget", "bid_strategy": "bid_strategy_default"}
        key = aliases.get(key, key)
        if key not in {"brand_voice", "banned_publishers", "banned_words", "default_daily_budget", "bid_strategy_default"}:
            return CampaignOut(ok=False, note=f"unknown preference key {inp.key}; use brand_voice, banned_publishers, banned_words, default_daily_budget or bid_strategy_default")
        if key in ("banned_publishers", "banned_words"):
            raw = inp.value if isinstance(inp.value, list) else [v.strip() for v in str(inp.value).replace(";", ",").split(",")]
            items = [str(i).strip() for i in raw if str(i).strip()]
            if key == "banned_publishers":
                items = [_resolve_publisher(ctx, i) for i in items]
                items = [i for i in items if i]
                if not items:
                    return CampaignOut(ok=False, note="no publisher in the catalog matched; use a catalog name or id like pub_001")
            merged = await repo.merge_list_preference(ctx.conn, ctx.user.id, key, items, "chat", ctx.interaction_id)
            ctx.memory.preferences[key] = merged
            names = [ctx.catalog.publisher(i).name for i in items] if key == "banned_publishers" else items
            return CampaignOut(note=f"Saved: never use {', '.join(names)}" if key == "banned_publishers" else f"Saved banned words: {', '.join(items)}")
        val = int(str(inp.value).replace("$", "").replace(",", "")) if key == "default_daily_budget" else str(inp.value)
        await repo.set_preference(ctx.conn, ctx.user.id, key, val, "chat", ctx.interaction_id)
        ctx.memory.preferences[key] = val
        return CampaignOut(note=f"Saved preference {key}")


def _resolve_publisher(ctx: AgentCtx, text: str) -> str | None:
    """Accept an id (pub_001), an exact name, or the first word of a name (case-insensitive)."""
    t = text.strip().lower()
    if ctx.catalog.has_publisher(t):
        return t
    for p in ctx.catalog.publishers:
        n = p.name.lower()
        if t == n or t == n.split()[0] or t.replace("&", "and") == n.replace("&", "and"):
            return p.id
    for p in ctx.catalog.publishers:
        if n := p.name.lower():
            if n.split()[0] in t or t in n:
                return p.id
    return None


class FactIn(BaseModel):
    text: str = Field(description="The fact to remember, as stated")
    scope: str = Field(default="user", description="'user' (all campaigns) or 'campaign'")


@register
class RememberFact(Tool[FactIn, CampaignOut]):
    name = "remember_fact"
    description = "Remember a fact about the advertiser for future prompts (e.g. 'our AOV is $85'). Free."
    Input, Output = FactIn, CampaignOut

    async def run(self, ctx: AgentCtx, inp: FactIn) -> CampaignOut:
        cid = ctx.campaign.id if (inp.scope == "campaign" and ctx.campaign) else None
        await repo.add_fact(ctx.conn, ctx.user.id, inp.text.strip(), "chat", cid, ctx.interaction_id)
        from ..memory import Fact
        ctx.memory.facts.append(Fact(id="new", text=inp.text.strip(), source="chat"))
        return CampaignOut(note="Remembered")


class ExportIn(BaseModel):
    format: str = Field(default="pdf", description="'pdf' or 'json'")


class ExportOut(BaseModel):
    url: str


@register
class ExportBrief(Tool[ExportIn, ExportOut]):
    name = "export_brief"
    description = "Get the download link for the campaign brief (PDF) or config (JSON). Free."
    Input, Output = ExportIn, ExportOut

    async def run(self, ctx: AgentCtx, inp: ExportIn) -> ExportOut:
        assert ctx.campaign
        fmt = "json" if inp.format == "json" else "pdf"
        return ExportOut(url=f"/api/campaigns/{ctx.campaign.id}/export.{fmt}")


class GetCampaignIn(BaseModel):
    pass


class GetCampaignOut(BaseModel):
    summary: str


@register
class GetCampaign(Tool[GetCampaignIn, GetCampaignOut]):
    name = "get_campaign"
    description = "Return a detailed text summary of the current campaign (publishers with reasons, creatives, config, checks)."
    Input, Output = GetCampaignIn, GetCampaignOut

    async def run(self, ctx: AgentCtx, inp: GetCampaignIn) -> GetCampaignOut:
        from .. import summarize
        assert ctx.campaign
        return GetCampaignOut(summary=summarize.detailed(ctx.campaign, ctx.catalog))
