"""Configuration via environment variables."""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # API
    api_title: str = "Data Talks API"
    api_prefix: str = "/api"
    debug: bool = False

    # Auth
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 1 week

    # DB: default SQLite; set DATABASE_URL in .env for PostgreSQL (e.g. postgresql+asyncpg://user:pass@host:5432/dbname)
    database_url: str = "sqlite+aiosqlite:///./data_talks.db"

    # Local file storage
    data_files_dir: str = "./data_files"

    # LLM: OpenAI or Ollama (local)
    llm_provider: str = "openai"  # "openai" | "ollama"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
