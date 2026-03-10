"""SQL discovery helpers for self-hosted database sources."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.database import get_db
from app.models import Agent, Source, User
from app.scripts.sql_utils import (
    list_sql_tables_sync,
    relationship_key,
    suggest_source_relationships,
    validate_source_relationships,
)

router = APIRouter(prefix="/sql", tags=["sql"])


@router.post("/tables")
async def list_tables(
    body: dict,
    _user: User = Depends(require_user),
):
    """List tables available for a SQL connection string."""
    connection_string = (body.get("connectionString") or body.get("connection_string") or "").strip()
    if not connection_string:
        raise HTTPException(400, "connectionString is required")

    loop = asyncio.get_event_loop()
    try:
        tables = await loop.run_in_executor(None, lambda: list_sql_tables_sync(connection_string))
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"tables": tables}


def _source_sql_payload(source: Source) -> dict:
    meta = source.metadata_ or {}
    table_infos = meta.get("table_infos") or []
    return {
        "id": source.id,
        "name": source.name,
        "connection_string": meta.get("connectionString", ""),
        "table_infos": table_infos,
        "is_active": source.is_active,
    }


async def _get_agent_sql_sources(
    agent_id: str,
    db: AsyncSession,
    user: User,
) -> tuple[Agent, list[Source]]:
    result = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.source_ids:
        source_result = await db.execute(
            select(Source).where(
                Source.user_id == user.id,
                Source.id.in_(agent.source_ids),
                Source.type == "sql_database",
            )
        )
    else:
        source_result = await db.execute(
            select(Source).where(
                Source.user_id == user.id,
                Source.agent_id == agent.id,
                Source.type == "sql_database",
            )
        )
    sources = list(source_result.scalars().all())
    return agent, sources


class RelationshipSaveBody(BaseModel):
    relationships: list[dict] = []


class DismissSuggestionBody(BaseModel):
    key: str


@router.get("/agents/{agent_id}/sources")
async def list_agent_sql_sources(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, user)
    source_rows = [_source_sql_payload(source) for source in sources]
    return {
        "sources": [
            {
                "id": row["id"],
                "name": row["name"],
                "is_active": row["is_active"],
                "table_infos": row["table_infos"],
            }
            for row in source_rows
        ],
        "relationships": agent.source_relationships or [],
    }


@router.get("/agents/{agent_id}/relationship-suggestions")
async def list_relationship_suggestions(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, user)
    source_rows = [_source_sql_payload(source) for source in sources]
    all_suggestions = suggest_source_relationships(source_rows)
    dismissed = set(getattr(agent, "dismissed_relationship_suggestions", None) or [])
    suggestions = [s for s in all_suggestions if relationship_key(s) not in dismissed]
    return {
        "sources": [
            {
                "id": row["id"],
                "name": row["name"],
                "is_active": row["is_active"],
                "table_infos": row["table_infos"],
            }
            for row in source_rows
        ],
        "relationships": agent.source_relationships or [],
        "suggestions": suggestions,
    }


@router.post("/agents/{agent_id}/dismiss-relationship-suggestion")
async def dismiss_relationship_suggestion(
    agent_id: str,
    body: DismissSuggestionBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    agent, _ = await _get_agent_sql_sources(agent_id, db, user)
    dismissed = list(getattr(agent, "dismissed_relationship_suggestions", None) or [])
    key = (body.key or "").strip()
    if key and key not in dismissed:
        dismissed.append(key)
        agent.dismissed_relationship_suggestions = dismissed
        await db.commit()
    return {"dismissed": agent.dismissed_relationship_suggestions or []}


@router.put("/agents/{agent_id}/relationships")
async def save_agent_relationships(
    agent_id: str,
    body: RelationshipSaveBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, user)
    source_rows = [_source_sql_payload(source) for source in sources]
    try:
        validated = validate_source_relationships(source_rows, body.relationships)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    agent.source_relationships = validated
    await db.commit()
    return {"relationships": validated}
