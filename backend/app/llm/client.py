"""Thin OpenAI wrapper: structured outputs, retries, usage capture.

`structured(prompt_name, OutModel, ...)` → (parsed OutModel, CallUsage). A schema/validation failure
is retried once with the error appended to the prompt; transport errors retry with backoff.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import TypeVar

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, ValidationError

from .. import observability as obs
from ..agent import prompts
from ..config import get_settings
from .usage import CallUsage

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(Exception):
    """Raised after retries are exhausted; the caller refunds any reservation."""


_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        s = get_settings()
        _client = AsyncOpenAI(api_key=s.openai_api_key, timeout=s.llm_timeout_s, max_retries=0)
    return _client


def resolve_model(tag: str) -> str:
    s = get_settings()
    return s.model_strong if tag == "strong" else tag if tag.startswith("gpt") else s.model_fast


async def structured(prompt_name: str, out_model: type[T], *, tool: str, model: str | None = None, **inputs) -> tuple[T, CallUsage]:
    p = prompts.load(prompt_name)
    text = p.render(**inputs)
    model = model or resolve_model(p.model)
    return await structured_raw(text, out_model, tool=tool, model=model, prompt_meta={"prompt": p.name, "prompt_version": p.version})


async def structured_raw(system_text: str, out_model: type[T], *, tool: str, model: str, user_text: str = "Produce the JSON object now.",
                         prompt_meta: dict | None = None) -> tuple[T, CallUsage]:
    s = get_settings()
    messages = [{"role": "system", "content": system_text}, {"role": "user", "content": user_text}]
    last_err: Exception | None = None
    meta = {"tool": tool, "schema": out_model.__name__, **(prompt_meta or {})}
    for attempt in range(s.llm_max_retries + 1):
        t0 = time.perf_counter()
        with obs.generation(f"llm.{tool}", model=model, input=messages, metadata={**meta, "attempt": attempt}, model_parameters={"temperature": 0.4}) as gen:
            try:
                resp = await client().chat.completions.parse(model=model, messages=messages, response_format=out_model, temperature=0.4)
                choice = resp.choices[0]
                if choice.message.refusal:
                    raise LLMUnavailable(f"model refused: {choice.message.refusal}")
                parsed = choice.message.parsed
                if parsed is None:
                    raise ValidationError.from_exception_data(out_model.__name__, [])
                u = resp.usage
                usage = CallUsage(tool=tool, model=model, prompt_tokens=u.prompt_tokens if u else 0, completion_tokens=u.completion_tokens if u else 0,
                                  total_tokens=u.total_tokens if u else 0, duration_ms=int((time.perf_counter() - t0) * 1000))
                obs.finish(gen, output=parsed, usage_details={"input": usage.prompt_tokens, "output": usage.completion_tokens, "total": usage.total_tokens})
                return parsed, usage
            except ValidationError as e:
                last_err = e
                log.warning("llm %s schema failure on attempt %s: %s", tool, attempt, str(e)[:300])
                obs.finish(gen, level="WARNING", status_message=f"schema failure: {str(e)[:200]}")
                messages.append({"role": "user", "content": f"Your previous answer failed validation: {str(e)[:800]}. Return a corrected JSON object."})
            except (APITimeoutError, APIConnectionError, RateLimitError) as e:
                last_err = e
                log.warning("llm %s transport failure on attempt %s: %s", tool, attempt, e)
                obs.finish(gen, level="ERROR", status_message=f"transport: {e}")
                await asyncio.sleep(0.8 * (2**attempt))
            except APIStatusError as e:
                last_err = e
                obs.finish(gen, level="ERROR", status_message=f"status {e.status_code}")
                if e.status_code < 500:
                    break
                await asyncio.sleep(0.8 * (2**attempt))
    raise LLMUnavailable(f"{tool}: {last_err}")
