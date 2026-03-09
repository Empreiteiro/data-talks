"""Configuration via environment variables."""
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from functools import lru_cache

# Load .env from backend/ so it works whether you run from backend/ or project root
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    # API
    api_title: str = "Data Talks API"
    api_prefix: str = "/api"
    debug: bool = False

    # Auth
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 1 week
    # Optional login: if False, no login required (single guest user). If True, use ADMIN_USERNAME + ADMIN_PASSWORD.
    enable_login: bool = False
    admin_username: str = ""
    admin_password: str = ""

    @field_validator("enable_login", mode="before")
    @classmethod
    def parse_enable_login(cls, v):
        """When ENABLE_LOGIN is not provided, empty, or not true/1/yes → False (no login required)."""
        if v is None:
            return False
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            s = v.strip().lower()
            if not s:
                return False
            return s in ("true", "1", "yes")
        return False

    @field_validator("admin_username", "admin_password", mode="before")
    @classmethod
    def strip_admin_creds(cls, v):
        """Strip whitespace/newlines from .env so login comparison works."""
        if isinstance(v, str):
            return v.strip()
        return v or ""

    # DB: default SQLite; set DATABASE_URL in .env for PostgreSQL (e.g. postgresql+asyncpg://user:pass@host:5432/dbname)
    database_url: str = "sqlite+aiosqlite:///./data_talks.db"

    # Local file storage
    data_files_dir: str = "./data_files"

    # LLM: OpenAI, Ollama, or LiteLLM proxy (OpenAI-compatible)
    llm_provider: str = "openai"  # "openai" | "ollama" | "litellm"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_audio_model: str = ""
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    litellm_base_url: str = "http://localhost:4000"
    litellm_model: str = "gpt-4o-mini"
    litellm_audio_model: str = ""
    litellm_api_key: str = ""

    @model_validator(mode="after")
    def apply_openai_defaults(self):
        """When an OpenAI key exists in .env, default text/audio models if omitted."""
        if self.openai_api_key.strip():
            if not (self.openai_model or "").strip():
                self.openai_model = "gpt-4o-mini"
            if not (self.openai_audio_model or "").strip():
                self.openai_audio_model = "gpt-4o-mini-tts"
        return self

    # Telegram Bot Settings
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""

    class Config:
        env_file = str(_ENV_FILE) if _ENV_FILE.exists() else ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
