"""Settings loaded from environment / the repo-root .env. One place for every knob."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=[REPO_ROOT / ".env", Path(".env")], env_file_encoding="utf-8", extra="ignore")

    # third parties
    openai_api_key: str
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str = ""
    database_url: str

    # models: cheap one for scoring/clarity/personas/config, strong one for copy + chat planner
    model_fast: str = "gpt-4.1-mini"
    model_strong: str = "gpt-4.1"
    llm_timeout_s: float = 45.0
    llm_max_retries: int = 2

    # serving
    cors_origins: str = "http://localhost:3000"
    serve_static: bool = False           # Shape A: mount frontend/out at /
    static_dir: Path = REPO_ROOT / "frontend" / "out"
    data_dir: Path = REPO_ROOT / "data"
    prompts_dir: Path = REPO_ROOT / "prompts"
    debug: bool = False

    # observability (Langfuse); empty keys = tracing off
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"
    langfuse_environment: str = "local"
    app_version: str = "0.1.0"

    # limits
    rate_generate_per_min: int = 10
    rate_chat_per_min: int = 60
    chat_max_tool_calls: int = 6
    max_repairs: int = 2

    cors_list: list[str] = Field(default_factory=list)

    def model_post_init(self, __context) -> None:  # noqa: D401
        self.cors_list = [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
