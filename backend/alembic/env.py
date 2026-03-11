"""
Alembic env: uses DATABASE_URL from environment.
Default SQLite (sync URL for migrations). For PostgreSQL, set DATABASE_URL and use psycopg2 for sync migrations.
"""
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context

from app.database import Base
from app.models import User, Source, Agent, QASession, Dashboard, DashboardChart, Alert, ApiKey
from app.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Build sync URL from DATABASE_URL for migrations (Alembic runs sync)
_settings = get_settings()
raw_url = _settings.database_url
if raw_url.startswith("sqlite+aiosqlite"):
    sync_url = raw_url.replace("sqlite+aiosqlite", "sqlite", 1)
elif raw_url.startswith("postgresql+asyncpg"):
    sync_url = raw_url.replace("postgresql+asyncpg", "postgresql+psycopg2", 1)
else:
    sync_url = raw_url

config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
