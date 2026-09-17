"""Deterministic checks over a campaign. Pure functions; every check names the tool that can repair it.

`run_all(campaign, catalog, memory)` returns one ValidationResult per check, passed or not.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date

from ...catalog import Catalog
from ...schemas.domain import Campaign, ValidationResult
from ..memory import MemoryBlock

Check = Callable[[Campaign, Catalog, MemoryBlock], tuple[str | None, dict]]
_CHECKS: list[tuple[str, str, str, Check]] = []  # (id, severity, repair_tool, fn)


def check(cid: str, severity: str, repair: str):
    def deco(fn: Check) -> Check:
        _CHECKS.append((cid, severity, repair, fn))
        return fn
    return deco


def _stem(text: str) -> set[str]:
    words = re.sub(r"[^a-z ]", " ", text.lower()).split()
    return {re.sub(r"(ing|ed|es|s)$", "", w) for w in words if len(w) > 3}


@check("alloc_sums_100", "error", "build_config")
def alloc_sums_100(c, cat, mem):
    if not c.config:
        return "Config missing.", {}
    total = sum(a.pct for a in c.config.allocation)
    return (None if total == 100 else f"Allocation totals {total}%, must be 100%."), {}


@check("alloc_cap_45", "warning", "build_config")
def alloc_cap_45(c, cat, mem):
    if not c.config or len(c.config.allocation) < 2:
        return None, {}
    cap = max(45, -(-100 // len(c.config.allocation)))  # two publishers can only be capped at 50
    over = [a for a in c.config.allocation if a.pct > cap]
    if over:
        return f"{cat.publisher(over[0].publisher_id).name} holds {over[0].pct}% — over the {cap}% single-publisher cap.", {"publisher_id": over[0].publisher_id}
    return None, {}


@check("no_excluded_in_alloc", "error", "build_config")
def no_excluded_in_alloc(c, cat, mem):
    if not c.config:
        return None, {}
    rec = {p.id for p in c.publishers}
    bad = [a for a in c.config.allocation if a.publisher_id not in rec]
    if bad:
        return f"{cat.publisher(bad[0].publisher_id).name} has budget but is not recommended.", {"publisher_id": bad[0].publisher_id}
    return None, {}


@check("min_publishers", "warning", "rank_publishers")
def min_publishers(c, cat, mem):
    n = len(c.publishers)
    return (None if n >= 3 else f"Only {n} publisher{'s' if n != 1 else ''} recommended; aim for at least 3 to get signal."), {}


@check("reason_present", "error", "rank_publishers")
def reason_present(c, cat, mem):
    for p in [*c.publishers, *c.excluded]:
        if len((p.why or "").strip()) < 40:
            return f"{cat.publisher(p.id).name} has no usable reason.", {"publisher_id": p.id}
    return None, {}


@check("creative_lengths", "error", "regenerate_creative")
def creative_lengths(c, cat, mem):
    for cr in c.creatives:
        if len(cr.headline) > 80 or not (60 <= len(cr.body) <= 240) or len(cr.cta) > 24:
            return (f"{cat.persona(cr.persona_id).name}: headline {len(cr.headline)}/80, body {len(cr.body)}/240, CTA {len(cr.cta)}/24.",
                    {"persona_id": cr.persona_id})
    return None, {}


@check("creative_avoids_disinterest", "warning", "regenerate_creative")
def creative_avoids_disinterest(c, cat, mem):
    for cr in c.creatives:
        per = cat.persona(cr.persona_id)
        text = _stem(cr.headline + " " + cr.body)
        for d in per.disinterested_in:
            stems = _stem(d) - {"position", "product", "onli", "messag", "framing", "brand", "claim", "voice"}
            if stems and stems <= text:  # every content word of the disinterest appears in the copy
                return f"{per.name} creative uses \"{d}\", a theme this persona is disinterested in.", {"persona_id": cr.persona_id}
    return None, {}


@check("creative_uses_preference", "error", "regenerate_creative")
def creative_uses_preference(c, cat, mem):
    voice = (mem.preferences.get("brand_voice") or "").lower()
    if "no exclamation" in voice or "no exclamation marks" in voice:
        for cr in c.creatives:
            if "!" in cr.headline + cr.body:
                return f"{cat.persona(cr.persona_id).name} creative uses \"!\" but brand voice says no exclamation marks.", {"persona_id": cr.persona_id}
    banned_words = mem.preferences.get("banned_words") or []
    for cr in c.creatives:
        for w in banned_words:
            if w.lower() in (cr.headline + " " + cr.body).lower():
                return f"{cat.persona(cr.persona_id).name} creative uses banned word \"{w}\".", {"persona_id": cr.persona_id}
    return None, {}


@check("persona_fit_floor", "warning", "pick_personas")
def persona_fit_floor(c, cat, mem):
    low = [p for p in c.personas if p.fit < 40]
    if low:
        return f"{cat.persona(low[0].id).name} fit is {low[0].fit}, below the 40 floor.", {"persona_id": low[0].id}
    return None, {}


@check("budget_sanity", "error", "set_budget")
def budget_sanity(c, cat, mem):
    if not c.config:
        return None, {}
    try:
        days = max(1, (date.fromisoformat(c.config.flight.end) - date.fromisoformat(c.config.flight.start)).days)
    except ValueError:
        return "Flight dates are not valid ISO dates.", {}
    implied = c.config.budget.daily_usd * days
    total = c.config.budget.total_usd or 1
    drift = abs(implied - total) / total
    if drift > 0.10:
        return f"Daily × {days} days = ${implied:,} vs total ${total:,} ({round(drift * 100)}% off).", {}
    return None, {}


@check("banned_publishers", "error", "drop_publisher")
def banned_publishers(c, cat, mem):
    banned = set(mem.preferences.get("banned_publishers") or [])
    hit = [p for p in c.publishers if p.id in banned]
    if hit:
        return f"{cat.publisher(hit[0].id).name} is on your banned list.", {"publisher_id": hit[0].id}
    return None, {}


def run_all(campaign: Campaign, catalog: Catalog, memory: MemoryBlock) -> list[ValidationResult]:
    out: list[ValidationResult] = []
    for cid, severity, repair, fn in _CHECKS:
        msg, target = fn(campaign, catalog, memory)
        out.append(ValidationResult(check=cid, severity=severity, passed=msg is None, message=msg or "OK", target=target, repair_tool=repair))
    return out


CHECK_IDS = [c[0] for c in _CHECKS]
