"""User memory: typed preferences (hard constraints) and free-text facts (context).

`MemoryBlock` is what tools and validators see; `render()` produces the ≤600-token prompt block.
Loading/saving lives in the repo layer (db/memory_repo) so this module stays pure.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

PREFERENCE_KEYS = {
    "brand_voice": "Brand voice (tone rules; e.g. 'understated, no exclamation marks')",
    "banned_publishers": "Publisher ids that must never be recommended",
    "banned_words": "Words that must never appear in creative",
    "default_daily_budget": "Default daily budget in USD",
    "bid_strategy_default": "Default bid strategy",
}


class Fact(BaseModel):
    id: str
    text: str
    source: str = "manual"
    campaign_id: str | None = None
    created_at: str | None = None


class MemoryBlock(BaseModel):
    preferences: dict[str, Any] = Field(default_factory=dict)
    sources: dict[str, dict] = Field(default_factory=dict)
    facts: list[Fact] = Field(default_factory=list)

    def render(self, publisher_names: dict[str, str] | None = None) -> str:
        """Compact, deterministic text for prompts. Preferences first (as constraints), then recent facts."""
        lines: list[str] = []
        p = self.preferences
        if p.get("brand_voice"):
            lines.append(f"- Brand voice (hard constraint): {p['brand_voice']}")
        if p.get("banned_words"):
            lines.append(f"- Never use these words: {', '.join(p['banned_words'])}")
        if p.get("banned_publishers"):
            names = [publisher_names.get(i, i) if publisher_names else i for i in p["banned_publishers"]]
            lines.append(f"- Never recommend these publishers: {', '.join(names)}")
        if p.get("default_daily_budget"):
            lines.append(f"- Default daily budget: ${p['default_daily_budget']}")
        if p.get("bid_strategy_default"):
            lines.append(f"- Preferred bid strategy: {p['bid_strategy_default']}")
        for f in self.facts[-10:]:
            lines.append(f"- Fact: {f.text}")
        if not lines:
            return "(no saved preferences or facts)"
        text = "\n".join(lines)
        return text[:2400]  # ~600 tokens


# Regex-based extraction (no LLM in the hot path). Returns candidate memory writes for a message.
_PATTERNS = {
    "fact": re.compile(r"^\s*remember(?:\s+that)?\s+(.+)$", re.I),
    "our": re.compile(r"\b(our (?:aov|budget|price|launch|customers?|margin)\b.+)$", re.I),
    "never_pub": re.compile(r"\b(?:never|don'?t|do not|avoid)\b.*?\b(?:use|run on|recommend)\s+([A-Za-z&' .]+?)(?:[.!,]|$)", re.I),
    "always": re.compile(r"\b(always|never|from now on)\b", re.I),
}


def extract_candidates(message: str, publisher_names: dict[str, str]) -> list[dict]:
    """Return [{'kind': 'fact'|'preference', 'key':..., 'value':...}] suggested by the message."""
    out: list[dict] = []
    if m := _PATTERNS["fact"].match(message):
        out.append({"kind": "fact", "text": m.group(1).strip()})
        return out
    if m := _PATTERNS["our"].search(message):
        out.append({"kind": "fact", "text": m.group(1).strip()})
    if m := _PATTERNS["never_pub"].search(message):
        wanted = m.group(1).strip().lower()
        for pid, name in publisher_names.items():
            if name.lower().split()[0] in wanted:
                out.append({"kind": "preference", "key": "banned_publishers", "value": [pid]})
                break
    if _PATTERNS["always"].search(message) and re.search(r"exclamation|tone|voice|formal|casual|understated|playful|jargon", message, re.I):
        out.append({"kind": "preference", "key": "brand_voice", "value": message.strip()})
    return out
