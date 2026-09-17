"""Per-interaction token accounting. Every LLM call appends a record; billing sums it."""
from __future__ import annotations

from pydantic import BaseModel, Field


class CallUsage(BaseModel):
    tool: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    duration_ms: int = 0


class Usage(BaseModel):
    calls: list[CallUsage] = Field(default_factory=list)

    def add(self, call: CallUsage) -> None:
        self.calls.append(call)

    @property
    def total_tokens(self) -> int:
        return sum(c.total_tokens for c in self.calls)

    def mix(self) -> str:
        """'4.1-mini ×4, 4.1 ×1' — the human-readable model mix shown on the ledger."""
        counts: dict[str, int] = {}
        for c in self.calls:
            short = c.model.replace("gpt-", "")
            counts[short] = counts.get(short, 0) + 1
        return ", ".join(f"{m} ×{n}" for m, n in counts.items()) or "—"

    def to_json(self) -> dict:
        return {"total_tokens": self.total_tokens, "mix": self.mix(), "calls": [c.model_dump() for c in self.calls]}
