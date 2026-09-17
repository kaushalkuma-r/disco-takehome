"""Loads prompts/*.md (frontmatter + body) and renders them. Versions are recorded per interaction."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ..config import get_settings


@dataclass(frozen=True)
class Prompt:
    name: str
    version: int
    model: str          # "fast" | "strong" — resolved against settings at call time
    inputs: tuple[str, ...]
    body: str

    def render(self, **kw: str) -> str:
        missing = [k for k in self.inputs if k not in kw]
        if missing:
            raise KeyError(f"prompt {self.name} missing inputs {missing}")
        # str.format_map would choke on braces inside JSON examples; do a plain token swap instead.
        text = self.body
        for k, v in kw.items():
            text = text.replace("{" + k + "}", str(v))
        return text.strip()


def _parse(path: Path) -> Prompt:
    raw = path.read_text(encoding="utf-8")
    assert raw.startswith("---"), f"{path} has no frontmatter"
    _, fm, body = raw.split("---", 2)
    meta: dict[str, str] = {}
    for line in fm.strip().splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    inputs = tuple(x.strip() for x in meta.get("inputs", "[]").strip("[]").split(",") if x.strip())
    return Prompt(name=meta["name"], version=int(meta.get("version", "1")), model=meta.get("model", "fast"), inputs=inputs, body=body)


@lru_cache
def load(name: str) -> Prompt:
    return _parse(get_settings().prompts_dir / f"{name}.md")


def versions() -> dict[str, int]:
    return {p.stem: load(p.stem).version for p in get_settings().prompts_dir.glob("*.md") if p.stem != "README"}
