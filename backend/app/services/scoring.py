"""Deterministic publisher pre-score.

    score = 0.35·category + 0.30·persona + 0.15·aov + 0.20·audience   (each 0–100)

Pure, fast and unit-tested; the LLM later adjusts by at most ±15 and writes the reason.
"""
from __future__ import annotations

import math

from ..catalog import Catalog, Persona, Publisher, tag_similarity
from ..schemas.domain import ParsedBrief, PublisherScore, ScoreBreakdown

WEIGHTS = {"category": 0.35, "persona": 0.30, "aov": 0.15, "audience": 0.20}

# Tags that describe how something is sold or to whom, not what it is. They never create a
# category match on their own (otherwise "subscription" makes meal kits look like dog food).
MODIFIER_TAGS = {"subscription", "subscription_boxes", "subscription_services", "women", "men", "dtc", "personalized", "gifting"}

# Implied buyer price for a tier when the brief gives no number.
TIER_PRICE = {"budget": 20, "mid": 50, "premium": 110, "luxury": 400, "unknown": 60}


def category_fit(brief_tags: list[str], pub: Publisher) -> float:
    """Best-match overlap: for each brief tag, the closest publisher tag; averaged, scaled to 0–100."""
    core = [t for t in brief_tags if t not in MODIFIER_TAGS] or brief_tags
    pub_tags = pub.tags - MODIFIER_TAGS or pub.tags
    per_tag = [max(tag_similarity(t, p) for p in pub_tags) for t in core]
    # Reward multiple strong matches without punishing one weak modifier tag too hard.
    per_tag.sort(reverse=True)
    weights = [1.0, 0.6, 0.4, 0.3][: len(per_tag)]
    base = 100 * sum(s * w for s, w in zip(per_tag, weights)) / sum(weights)
    # Modifier agreement (e.g. both subscription) is worth a small bonus, never a match by itself.
    bonus = 8 if (set(brief_tags) & MODIFIER_TAGS & pub.tags) else 0
    return min(100.0, base + bonus)


def persona_fit_for_publisher(brief_tags: list[str], pub: Publisher, personas: list[Persona]) -> float:
    """Mean of the top-3 persona affinities that are plausible for this publisher's audience.

    A persona is plausible for a publisher when its affinities overlap the publisher's tags;
    its fit to the brief is the affinity overlap with the brief's categories.
    """
    if not brief_tags:
        return 30.0
    core = [t for t in brief_tags if t not in MODIFIER_TAGS] or brief_tags
    pub_core = pub.tags - MODIFIER_TAGS or pub.tags
    plausible: list[float] = []
    for per in personas:
        aff = [a for a in per.category_affinities if a not in MODIFIER_TAGS] or per.category_affinities
        pub_overlap = max((tag_similarity(a, p) for a in aff for p in pub_core), default=0.0)
        if pub_overlap < 0.5:
            continue
        brief_overlap = max((tag_similarity(a, t) for a in aff for t in core), default=0.0)
        age_ok = _band_overlap(per.age_band, pub.age_band) > 0.3
        plausible.append(100 * brief_overlap * (1.0 if age_ok else 0.7) * (0.6 + 0.4 * pub_overlap))
    if not plausible:
        return 10.0
    plausible.sort(reverse=True)
    return sum(plausible[:3]) / min(3, len(plausible))


def aov_fit(brief: ParsedBrief, pub: Publisher) -> float:
    """Order-of-magnitude distance between the brief's price point and the publisher AOV."""
    price = brief.price_point_usd or TIER_PRICE[brief.price_tier]
    dist = abs(math.log(max(price, 1) / max(pub.avg_order_value_usd, 1)))
    return max(0.0, 100 - dist * 60)


def audience_fit(brief: ParsedBrief, pub: Publisher, personas: list[Persona]) -> float:
    """Age-band overlap with the personas that match the brief, gender compatibility, income vs tier."""
    matching = [p for p in personas if max((tag_similarity(a, t) for a in p.category_affinities for t in brief.categories), default=0.0) >= 0.6]
    if matching:
        age = sum(_band_overlap(p.age_band, pub.age_band) for p in matching) / len(matching)
        female_wanted = _gender_share(matching)
    else:
        age, female_wanted = 0.5, 0.5
    gender = 1 - abs(female_wanted - pub.female_share)
    buyer = brief.buyer.lower()
    if any(w in buyer for w in ("women", "woman", "female", "moms", "mothers")):
        gender = pub.female_share
    elif any(w in buyer for w in (" men", "male", "dads")):
        gender = 1 - pub.female_share
    income = {"budget": {"mid": 1.0, "mid-high": 0.7, "high": 0.4}, "mid": {"mid": 1.0, "mid-high": 0.9, "high": 0.7},
              "premium": {"mid": 0.6, "mid-high": 1.0, "high": 1.0}, "luxury": {"mid": 0.3, "mid-high": 0.6, "high": 1.0},
              "unknown": {"mid": 0.8, "mid-high": 0.9, "high": 0.8}}[brief.price_tier].get(pub.audience.income_tier, 0.7)
    return 100 * (0.45 * age + 0.25 * gender + 0.30 * income)


def prescore(brief: ParsedBrief, catalog: Catalog) -> list[PublisherScore]:
    tags = [t.lower() for t in brief.categories]
    out: list[PublisherScore] = []
    for pub in catalog.publishers:
        bd = ScoreBreakdown(
            category=round(category_fit(tags, pub)),
            persona=round(persona_fit_for_publisher(tags, pub, catalog.personas)),
            aov=round(aov_fit(brief, pub)),
            audience=round(audience_fit(brief, pub, catalog.personas)),
        )
        score = round(sum(WEIGHTS[k] * getattr(bd, k) for k in WEIGHTS))
        if not brief.is_consumer_commerce:
            score = min(score, 35)  # the catalog is consumer commerce; nothing fits an off-topic brief well
        out.append(PublisherScore(id=pub.id, score=score, prescore=score, bd=bd))
    out.sort(key=lambda s: (-s.score, s.id))
    return out


def _band_overlap(a: tuple[int, int], b: tuple[int, int]) -> float:
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    if hi <= lo:
        return 0.0
    return (hi - lo) / min(a[1] - a[0], b[1] - b[0])


def _gender_share(personas: list[Persona]) -> float:
    m = {"female": 0.85, "female-leaning": 0.7, "balanced": 0.5, "male-leaning": 0.3, "male": 0.15}
    return sum(m.get(p.gender_skew, 0.5) for p in personas) / len(personas)
