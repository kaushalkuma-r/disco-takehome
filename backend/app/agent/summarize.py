"""Text summaries of a campaign for prompts (chat system prompt) and tool results."""
from __future__ import annotations

from ..catalog import Catalog
from ..schemas.domain import Campaign


def short(c: Campaign | None, cat: Catalog) -> str:
    if c is None:
        return "(no campaign yet — the user has not built one in this thread)"
    pubs = ", ".join(f"{cat.publisher(p.id).name} [{p.id}] {p.score}" for p in c.publishers)
    pers = ", ".join(f"{cat.persona(p.id).name} [{p.id}] (fit {p.fit})" for p in c.personas)
    cfg = c.config
    budget = f"${cfg.budget.total_usd:,} total / ${cfg.budget.daily_usd:,} per day, {cfg.bid.strategy}, objective {cfg.objective}" if cfg else "no config"
    alloc = ", ".join(f"{cat.publisher(a.publisher_id).name} {a.pct}%" for a in cfg.allocation) if cfg else ""
    return (f"id {c.id} · '{c.name}' · v{c.version} · status {c.status} · clarity {c.clarity.score}\n"
            f"Brief: {c.brief}\nInterpretation: {c.clarity.summary}\nPublishers: {pubs}\nExcluded: {', '.join(cat.publisher(e.id).name for e in c.excluded[:5])}\n"
            f"Personas: {pers}\nCreatives (variant letter → persona_id to pass to regenerate_creative): "
            f"{'; '.join(f'{chr(65+i)} = {x.persona_id} ({cat.persona(x.persona_id).name}): {x.headline}' for i, x in enumerate(c.creatives))}\n"
            f"Config: {budget}. Allocation: {alloc}")


def detailed(c: Campaign, cat: Catalog) -> str:
    lines = [short(c, cat), "", "Publisher reasons:"]
    for p in c.publishers:
        lines.append(f"- {cat.publisher(p.id).name} {p.score} (pre {p.prescore}, delta {p.llm_delta:+}; category {p.bd.category}, persona {p.bd.persona}, aov {p.bd.aov}, audience {p.bd.audience}): {p.why}")
    lines.append("Exclusions:")
    for e in c.excluded:
        lines.append(f"- {cat.publisher(e.id).name}: {e.why}")
    lines.append("Creatives:")
    for x in c.creatives:
        lines.append(f"- {cat.persona(x.persona_id).name}: '{x.headline}' / '{x.body}' / CTA '{x.cta}'")
    if c.config:
        lines.append(f"Bid rationale: {c.config.bid.rationale}")
    return "\n".join(lines)
