"""Typed tool registry. A tool is Input → Output with a cost descriptor; the same models drive
OpenAI function-calling schemas for chat, so the two front doors can never drift."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, ClassVar, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel

from ..catalog import Catalog
from ..llm.usage import Usage
from ..schemas.domain import Campaign
from .memory import MemoryBlock

I = TypeVar("I", bound=BaseModel)
O = TypeVar("O", bound=BaseModel)


@dataclass(frozen=True)
class Cost:
    base: int = 0
    usage: bool = False       # charge tokens_to_credits(usage) on settle

    @classmethod
    def free(cls) -> "Cost":
        return cls(0, False)


@dataclass
class StageEvent:
    stage: str
    status: str               # run | done | fail
    detail: str = ""
    ms: int = 0


@dataclass
class UserCtx:
    id: UUID
    email: str
    name: str = ""


@dataclass
class AgentCtx:
    """Everything a tool may touch. `conn` is an asyncpg connection inside the interaction's transaction."""
    user: UserCtx
    thread_id: UUID | None
    interaction_id: UUID | None
    catalog: Catalog
    memory: MemoryBlock
    usage: Usage = field(default_factory=Usage)
    campaign: Campaign | None = None
    conn: Any = None
    emit: Callable[[StageEvent], Awaitable[None] | None] | None = None
    llm_calls: int = 0

    async def stage(self, stage: str, status: str, detail: str = "", ms: int = 0) -> None:
        if self.emit:
            r = self.emit(StageEvent(stage, status, detail, ms))
            if hasattr(r, "__await__"):
                await r

    def publisher_names(self) -> dict[str, str]:
        return {p.id: p.name for p in self.catalog.publishers}


class Tool(Generic[I, O]):
    name: ClassVar[str]
    description: ClassVar[str]
    Input: ClassVar[type[BaseModel]]
    Output: ClassVar[type[BaseModel]]
    cost: ClassVar[Cost] = Cost.free()
    mutates: ClassVar[bool] = False
    chat_exposed: ClassVar[bool] = True

    async def run(self, ctx: AgentCtx, inp: I) -> O:  # pragma: no cover - interface
        raise NotImplementedError

    @classmethod
    def openai_schema(cls) -> dict:
        schema = cls.Input.model_json_schema()
        schema.pop("title", None)
        return {"type": "function", "function": {"name": cls.name, "description": cls.description, "parameters": schema}}


_REGISTRY: dict[str, type[Tool]] = {}


def register(cls: type[Tool]) -> type[Tool]:
    _REGISTRY[cls.name] = cls
    return cls


def get(name: str) -> type[Tool]:
    return _REGISTRY[name]


def all_tools() -> dict[str, type[Tool]]:
    return dict(_REGISTRY)


def chat_schemas() -> list[dict]:
    return [t.openai_schema() for t in _REGISTRY.values() if t.chat_exposed]
