"""SQL discovery helpers for self-hosted database sources."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership
from app.services.tenant_scope import tenant_filter
from app.database import get_db
from app.models import Agent, LlmConfig, Source
from app.scripts.sql_relationships_llm import suggest_source_relationships_llm
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
    _scope: TenantScope = Depends(require_membership),
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
    scope: TenantScope,
) -> tuple[Agent, list[Source]]:
    result = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.source_ids:
        source_result = await db.execute(
            select(Source).where(
                tenant_filter(Source, scope),
                Source.id.in_(agent.source_ids),
                Source.type == "sql_database",
            )
        )
    else:
        source_result = await db.execute(
            select(Source).where(
                tenant_filter(Source, scope),
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
    scope: TenantScope = Depends(require_membership),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, scope)
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
    scope: TenantScope = Depends(require_membership),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, scope)
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


async def _resolve_llm_overrides_for_agent(
    db: AsyncSession, scope: TenantScope, agent: Agent
) -> dict | None:
    """Pick the LLM config to use for this agent.

    Mirrors the resolver in `onboarding_router._resolve_llm_overrides_for_agent`
    but takes a hydrated `Agent` to avoid re-fetching: the caller already
    has it from `_get_agent_sql_sources`.

    Order of preference:
      1. The agent's own `llm_config_id` (if set and the user owns it).
      2. The user's default `LlmConfig` (`is_default=True`).
      3. None — `chat_completion` falls back to env-level settings.
    """
    # Local import to avoid a circular dependency between sql_router and ask
    # (ask depends on quite a bit of the request stack at import time).
    from app.routers.ask import _llm_config_to_overrides

    if agent.llm_config_id:
        r = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == agent.llm_config_id,
                LlmConfig.user_id == scope.user.id,
            )
        )
        cfg = r.scalar_one_or_none()
        if cfg:
            return _llm_config_to_overrides(cfg)
    r_default = await db.execute(
        select(LlmConfig).where(
            LlmConfig.user_id == scope.user.id,
            LlmConfig.is_default == True,  # noqa: E712
        )
    )
    default_cfg = r_default.scalar_one_or_none()
    if default_cfg:
        return _llm_config_to_overrides(default_cfg)
    return None


@router.post("/agents/{agent_id}/suggest-relationships-llm")
async def llm_relationship_suggestions(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Use the LLM to suggest foreign-key style relationships across the
    agent's SQL sources. Validated against actual table/column metadata
    and filtered to exclude already-saved or dismissed entries — the
    caller can render the result directly.

    POST (not GET) because each call burns LLM tokens; we don't want
    HTTP caching layers to hide that cost from the user.
    """
    agent, sources = await _get_agent_sql_sources(agent_id, db, scope)
    source_rows = [_source_sql_payload(source) for source in sources]
    existing = list(agent.source_relationships or [])
    dismissed = set(getattr(agent, "dismissed_relationship_suggestions", None) or [])

    overrides = await _resolve_llm_overrides_for_agent(db, scope, agent)
    suggestions = await suggest_source_relationships_llm(
        source_rows,
        existing_relationships=existing,
        llm_overrides=overrides,
    )
    suggestions = [s for s in suggestions if relationship_key(s) not in dismissed]

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
        "relationships": existing,
        "suggestions": suggestions,
    }


@router.post("/agents/{agent_id}/dismiss-relationship-suggestion")
async def dismiss_relationship_suggestion(
    agent_id: str,
    body: DismissSuggestionBody,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    agent, _ = await _get_agent_sql_sources(agent_id, db, scope)
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
    scope: TenantScope = Depends(require_membership),
):
    agent, sources = await _get_agent_sql_sources(agent_id, db, scope)
    source_rows = [_source_sql_payload(source) for source in sources]
    try:
        validated = validate_source_relationships(source_rows, body.relationships)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    agent.source_relationships = validated
    await db.commit()
    return {"relationships": validated}
