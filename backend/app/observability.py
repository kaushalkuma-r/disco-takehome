"""Langfuse tracing shaped like the agent: one trace per interaction, typed observations underneath.

    agent      — an interaction (generate / chat turn / repair / edit)
    tool       — every registry tool call (input → output)
    generation — every model call, with model, prompt name+version, token usage
    guardrail  — the validator pass (which checks failed, what was repaired)

No keys configured → every helper is a no-op, so tests and local runs never depend on Langfuse.
"""
from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any

from .config import get_settings

log = logging.getLogger(__name__)
_client: Any = None
_enabled: bool | None = None


def enabled() -> bool:
    global _enabled, _client
    if _enabled is None:
        s = get_settings()
        if s.langfuse_public_key and s.langfuse_secret_key:
            try:
                from langfuse import Langfuse

                _client = Langfuse(public_key=s.langfuse_public_key, secret_key=s.langfuse_secret_key, base_url=s.langfuse_base_url,
                                   environment=s.langfuse_environment, release=s.app_version)
                _enabled = True
                log.info("langfuse tracing enabled (%s)", s.langfuse_base_url)
            except Exception as e:  # noqa: BLE001
                log.warning("langfuse disabled: %s", e)
                _enabled = False
        else:
            _enabled = False
    return _enabled


def _trim(v: Any, limit: int = 6000) -> Any:
    """Keep payloads readable in the UI; large tool inputs/outputs are truncated, not dropped."""
    if v is None:
        return None
    if hasattr(v, "model_dump"):
        v = v.model_dump(mode="json")
    if isinstance(v, str) and len(v) > limit:
        return v[:limit] + f"… (+{len(v) - limit} chars)"
    return v


@contextlib.contextmanager
def observation(kind: str, name: str, *, input: Any = None, metadata: dict | None = None, **kw) -> Iterator[Any]:
    """Generic typed observation. Yields the Langfuse object (or None) so callers can `.update(output=...)`."""
    if not enabled():
        yield None
        return
    with _client.start_as_current_observation(as_type=kind, name=name, input=_trim(input), metadata=metadata, **kw) as obs:
        yield obs


@contextlib.contextmanager
def agent(name: str, *, user_id: str, session_id: str | None, tags: list[str], input: Any = None, metadata: dict | None = None) -> Iterator[Any]:
    """Root of an interaction. Trace-level user/session/tags let Langfuse group by advertiser and by thread."""
    if not enabled():
        yield None
        return
    from langfuse import propagate_attributes

    with propagate_attributes(user_id=user_id, session_id=session_id, tags=tags, trace_name=name, metadata=_flat(metadata)):
        with observation("agent", name, input=input, metadata=metadata) as obs:
            if obs is not None:
                obs.set_trace_io(input=_trim(input))
            yield obs


def _flat(md: dict | None) -> dict[str, str] | None:
    """propagate_attributes metadata must be flat string values."""
    if not md:
        return None
    return {k: (v if isinstance(v, str) else str(v))[:500] for k, v in md.items() if v is not None}


@contextlib.contextmanager
def tool(name: str, input: Any = None, metadata: dict | None = None) -> Iterator[Any]:
    with observation("tool", name, input=input, metadata=metadata) as obs:
        yield obs


@contextlib.contextmanager
def generation(name: str, *, model: str, input: Any = None, metadata: dict | None = None, model_parameters: dict | None = None) -> Iterator[Any]:
    with observation("generation", name, input=input, metadata=metadata, model=model, model_parameters=model_parameters) as obs:
        yield obs


@contextlib.contextmanager
def guardrail(name: str, input: Any = None, metadata: dict | None = None) -> Iterator[Any]:
    with observation("guardrail", name, input=input, metadata=metadata) as obs:
        yield obs


def finish(obs: Any, *, output: Any = None, level: str | None = None, status_message: str | None = None, **kw) -> None:
    if obs is None:
        return
    try:
        obs.update(output=_trim(output), level=level, status_message=status_message, **kw)
    except Exception as e:  # noqa: BLE001
        log.debug("langfuse update failed: %s", e)


def finish_trace(obs: Any, *, output: Any = None, metadata: dict | None = None) -> None:
    """Close the root: output on both the agent observation and the trace, metadata on the observation."""
    if obs is None:
        return
    try:
        obs.update(output=_trim(output), metadata=metadata)
        obs.set_trace_io(output=_trim(output))
    except Exception as e:  # noqa: BLE001
        log.debug("langfuse trace update failed: %s", e)


def flush() -> None:
    if enabled():
        try:
            _client.flush()
        except Exception:  # noqa: BLE001
            pass


def shutdown() -> None:
    if enabled():
        try:
            _client.shutdown()
        except Exception:  # noqa: BLE001
            pass
