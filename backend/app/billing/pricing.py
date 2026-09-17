"""Credit pricing: a base fee per model-touching action plus 1 credit per 4k weighted tokens."""
from __future__ import annotations

import math

from ..llm.usage import Usage

SIGNUP_GRANT = 100
TOKENS_PER_CREDIT = 4_000
MODEL_WEIGHT = {"gpt-4.1-mini": 1.0, "gpt-4.1-nano": 0.5, "gpt-4.1": 2.0, "gpt-4o-mini": 1.0, "gpt-4o": 2.0}
BASE = {"generate_campaign": 10, "regenerate_creative": 2, "chat_llm_edit": 1, "feedback_repair": 1}
# Median observed usage per action, used only for the pre-run estimate shown in the UI.
EST_USAGE = {"generate_campaign": 2, "regenerate_creative": 1, "chat_llm_edit": 1, "feedback_repair": 1}


def base_for(action: str) -> int:
    return BASE.get(action, 0)


def weight(model: str) -> float:
    for k, w in MODEL_WEIGHT.items():
        if model.startswith(k):
            return w
    return 1.0


def tokens_to_credits(usage: Usage) -> int:
    weighted = sum(c.total_tokens * weight(c.model) for c in usage.calls)
    return math.ceil(weighted / TOKENS_PER_CREDIT) if weighted else 0


def estimate(action: str) -> dict:
    base = base_for(action)
    est = EST_USAGE.get(action, 0)
    return {"action": action, "base": base, "est_usage": est, "total": base + est}
