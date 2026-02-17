"""
Platform-wide LLM activity logs. Persisted in DB (SQLite or PostgreSQL).
Logs all LLM calls: pergunta (ask), summary, etc.
"""
import uuid
from typing import Any

from sqlalchemy import select, desc

from app.database import AsyncSessionLocal
from app.models import PlatformLog


async def record_log(
    action: str,
    provider: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    context: str | None = None,
) -> None:
    """Persist a log entry to the database."""
    async with AsyncSessionLocal() as session:
        entry = PlatformLog(
            id=str(uuid.uuid4()),
            action=action,
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            context=context,
        )
        session.add(entry)
        await session.commit()


async def list_logs(limit: int = 100) -> list[dict[str, Any]]:
    """Return the most recent logs (newest first) from the database."""
    async with AsyncSessionLocal() as session:
        stmt = (
            select(PlatformLog)
            .order_by(desc(PlatformLog.created_at))
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()
        return [
            {
                "action": r.action,
                "timestamp": r.created_at.isoformat() if r.created_at else "",
                "provider": r.provider,
                "model": r.model,
                "input_tokens": r.input_tokens or 0,
                "output_tokens": r.output_tokens or 0,
                "context": r.context,
            }
            for r in rows
        ]
