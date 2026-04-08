"""CDP (Customer Data Platform) API — identity resolution, enrichment, segmentation."""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.config import get_settings
from app.database import get_db
from app.models import User, Agent, Source, LlmConfig
from app.services import cdp_service

router = APIRouter(prefix="/cdp", tags=["cdp"])


def _resolve_llm(agent, user_id, db):
    """Helper imported inline to avoid circular deps."""
    from app.routers.ask import _llm_config_to_overrides
    return _llm_config_to_overrides


class CdpRequest(BaseModel):
    agentId: str
    language: Optional[str] = None


class CdpEnrichRequest(BaseModel):
    agentId: str
    language: Optional[str] = None
    unifiedSchema: Optional[dict] = None


class CdpSegmentRequest(BaseModel):
    agentId: str
    language: Optional[str] = None
    enrichedSchema: Optional[dict] = None


async def _get_agent_and_llm(agent_id: str, user: User, db: AsyncSession):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")

    from app.routers.ask import _llm_config_to_overrides
    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)

    return agent, llm_overrides


@router.post("/identity-resolution")
async def suggest_identity_resolution(
    body: CdpRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """AI suggests how to unify customer records across sources."""
    agent, llm_overrides = await _get_agent_and_llm(body.agentId, user, db)

    # Load all active sources for this workspace
    r = await db.execute(
        select(Source).where(Source.agent_id == agent.id, Source.user_id == user.id)
    )
    sources = list(r.scalars().all())
    if len(sources) < 1:
        raise HTTPException(400, "At least one source is required for identity resolution")

    try:
        result = await cdp_service.suggest_identity_resolution(
            agent, sources, db, llm_overrides=llm_overrides, language=body.language,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    # Save to workspace_config
    config = agent.workspace_config or {}
    config["identity_resolution"] = result
    agent.workspace_config = config
    await db.commit()

    return result


@router.post("/enrichment")
async def suggest_enrichment(
    body: CdpEnrichRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """AI suggests customer metrics to calculate."""
    agent, llm_overrides = await _get_agent_and_llm(body.agentId, user, db)

    config = agent.workspace_config or {}
    unified_schema = body.unifiedSchema or config.get("identity_resolution", {})
    if not unified_schema:
        raise HTTPException(400, "Run identity resolution first")

    try:
        result = await cdp_service.suggest_enrichment(
            agent, unified_schema, db, llm_overrides=llm_overrides, language=body.language,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    config["enrichment"] = result
    agent.workspace_config = config
    await db.commit()

    return result


@router.post("/segmentation")
async def suggest_segmentation(
    body: CdpSegmentRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """AI suggests customer segmentation rules."""
    agent, llm_overrides = await _get_agent_and_llm(body.agentId, user, db)

    config = agent.workspace_config or {}
    enriched_schema = body.enrichedSchema or config.get("enrichment", {})
    if not enriched_schema:
        raise HTTPException(400, "Run enrichment first")

    try:
        result = await cdp_service.suggest_segmentation(
            agent, enriched_schema, db, llm_overrides=llm_overrides, language=body.language,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    config["segmentation"] = result
    agent.workspace_config = config
    await db.commit()

    return result


@router.get("/config/{agent_id}")
async def get_cdp_config(
    agent_id: str,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the CDP configuration for a workspace."""
    r = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")
    return agent.workspace_config or {}
