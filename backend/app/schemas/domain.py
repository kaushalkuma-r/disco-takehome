"""Domain models. These are the shapes stored as JSONB, returned by the API, and produced by tools.

LLM-facing output models live here too (suffix *Out) so the structured-output schema and the
persisted shape can never drift apart.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

PriceTier = Literal["budget", "mid", "premium", "luxury", "unknown"]
BusinessModel = Literal["one_time", "subscription", "service", "b2b", "app", "unknown"]


# ----------------------------------------------------------------------------- clarity
class ClarityQuestion(BaseModel):
    q: str
    opts: list[str] = Field(min_length=2, max_length=6)
    multi: bool = Field(default=False, description="True when several options can apply at once (e.g. product types sold, audiences served)")


class ParsedBrief(BaseModel):
    product: str = ""
    buyer: str = ""
    price_tier: PriceTier = "unknown"
    price_point_usd: int | None = None
    business_model: BusinessModel = "unknown"
    categories: list[str] = Field(default_factory=list, description="catalog-style tags, snake_case")
    differentiators: list[str] = Field(default_factory=list)
    is_consumer_commerce: bool = True


class ClarityResult(BaseModel):
    score: int = Field(ge=0, le=100)
    label: Literal["Vague", "Usable", "Clear"]
    summary: str
    signals: list[str] = Field(default_factory=list, description="what the brief does or does not tell us")
    missing: list[str] = Field(default_factory=list)
    questions: list[ClarityQuestion] = Field(default_factory=list, max_length=3)
    parsed_brief: ParsedBrief
    answers: list[str] = Field(default_factory=list)


# ----------------------------------------------------------------------------- publishers
class ScoreBreakdown(BaseModel):
    category: int = Field(ge=0, le=100)
    persona: int = Field(ge=0, le=100)
    aov: int = Field(ge=0, le=100)
    audience: int = Field(ge=0, le=100)


class PublisherScore(BaseModel):
    id: str
    score: int = Field(ge=0, le=100)
    prescore: int = Field(ge=0, le=100)
    llm_delta: int = 0
    bd: ScoreBreakdown
    why: str = ""


class ExcludedPublisher(BaseModel):
    id: str
    score: int = Field(ge=0, le=100, default=0)
    why: str


# ----------------------------------------------------------------------------- personas / creative
class PersonaPick(BaseModel):
    id: str
    fit: int = Field(ge=0, le=100)
    why: str


class SkippedPersona(BaseModel):
    id: str
    why: str


class Creative(BaseModel):
    persona_id: str
    headline: str = Field(max_length=120)
    body: str = Field(max_length=400)
    cta: str = Field(max_length=40)
    rationale: str = ""
    assumptions: list[str] = Field(default_factory=list, description="Claims the copy implies that the brief did not state; confirm before running")


# ----------------------------------------------------------------------------- config
class Bid(BaseModel):
    strategy: Literal["target_cpa", "max_conversions_with_cpa_cap", "manual_cpm", "manual_cpc", "max_clicks"]
    cpm_range_usd: str
    cpc_range_usd: str
    rationale: str = ""


class Budget(BaseModel):
    daily_usd: int = Field(ge=0)
    total_usd: int = Field(ge=0)
    currency: str = "USD"
    pacing: Literal["even", "accelerated"] = "even"


class Flight(BaseModel):
    start: str
    end: str


class Targeting(BaseModel):
    age_range: str
    gender: str
    income_tiers: list[str]
    geos: list[str]
    interests: list[str]
    exclude_contexts: list[str] = Field(default_factory=list)


class Allocation(BaseModel):
    publisher_id: str
    pct: int = Field(ge=0, le=100)


class CampaignConfig(BaseModel):
    objective: Literal["purchase", "subscription_signup", "trial_start", "lead", "traffic"]
    primary_kpi: str
    bid: Bid
    budget: Budget
    flight: Flight
    targeting: Targeting
    allocation: list[Allocation]
    frequency_cap: dict = Field(default_factory=lambda: {"impressions": 3, "per": "day"})
    attribution: dict = Field(default_factory=lambda: {"window_days": 7, "model": "last_touch"})


# ----------------------------------------------------------------------------- validation / credits
class ValidationResult(BaseModel):
    check: str
    severity: Literal["error", "warning"]
    passed: bool
    message: str
    target: dict = Field(default_factory=dict)
    repair_tool: str | None = None


class CreditsInfo(BaseModel):
    charged: int = 0
    base: int = 0
    usage: int = 0
    balance: int


# ----------------------------------------------------------------------------- campaign
CampaignStatus = Literal["generating", "draft", "needs_review", "ready", "failed"]


class Campaign(BaseModel):
    id: UUID
    user_id: UUID
    thread_id: UUID | None = None
    parent_campaign_id: UUID | None = None
    name: str
    brief: str
    clarity: ClarityResult
    parsed_brief: ParsedBrief
    publishers: list[PublisherScore] = Field(default_factory=list)
    excluded: list[ExcludedPublisher] = Field(default_factory=list)
    personas: list[PersonaPick] = Field(default_factory=list)
    skipped_personas: list[SkippedPersona] = Field(default_factory=list)
    creatives: list[Creative] = Field(default_factory=list)
    config: CampaignConfig | None = None
    status: CampaignStatus = "draft"
    version: int = 1
    created_at: datetime
    updated_at: datetime

    def snapshot(self) -> dict:
        """The mutable part of a campaign, stored per version and restored on undo."""
        return self.model_dump(mode="json", include={"publishers", "excluded", "personas", "skipped_personas", "creatives", "config", "name"})


class MutationResponse(BaseModel):
    campaign: Campaign
    validation: list[ValidationResult]
    credits: CreditsInfo
