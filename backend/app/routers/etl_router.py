"""ETL Pipeline API — pipeline builder, transforms, and lineage."""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.database import get_db
from app.models import User, Agent, Source, LlmConfig
from app.services import etl_service

router = APIRouter(prefix="/etl", tags=["etl"])


class PipelineRequest(BaseModel):
    agentId: str
    description: str
    language: Optional[str] = None


class TransformRequest(BaseModel):
    agentId: str
    description: str
    language: Optional[str] = None


async def _get_agent_and_llm(agent_id: str, user: User, db: AsyncSession):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
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


@router.post("/pipeline/suggest")
async def suggest_pipeline(
    body: PipelineRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """AI suggests a full ETL pipeline based on sources and description."""
    agent, llm_overrides = await _get_agent_and_llm(body.agentId, user, db)

    r = await db.execute(
        select(Source).where(Source.agent_id == agent.id, tenant_filter(Source, scope))
    )
    sources = list(r.scalars().all())
    if not sources:
        raise HTTPException(400, "At least one source is required")

    try:
        result = await etl_service.suggest_pipeline(
            agent, sources, body.description, db,
            llm_overrides=llm_overrides, language=body.language,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    # Save pipeline to workspace_config
    config = agent.workspace_config or {}
    pipelines = config.get("pipelines", [])
    result["id"] = f"pipeline_{len(pipelines) + 1}"
    pipelines.append(result)
    config["pipelines"] = pipelines
    agent.workspace_config = config
    await db.commit()

    return result


@router.post("/transform/suggest")
async def suggest_transform(
    body: TransformRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """AI generates a single SQL transform."""
    agent, llm_overrides = await _get_agent_and_llm(body.agentId, user, db)

    r = await db.execute(
        select(Source).where(Source.agent_id == agent.id, tenant_filter(Source, scope))
    )
    sources = list(r.scalars().all())

    try:
        result = await etl_service.suggest_transform(
            agent, sources, body.description, db,
            llm_overrides=llm_overrides, language=body.language,
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return result


@router.get("/pipelines/{agent_id}")
async def list_pipelines(
    agent_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """List all pipelines for a workspace."""
    r = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")
    config = agent.workspace_config or {}
    return config.get("pipelines", [])


@router.get("/lineage/{agent_id}")
async def get_lineage(
    agent_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """Get the lineage graph for all pipelines in a workspace."""
    r = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")
    config = agent.workspace_config or {}
    pipelines = config.get("pipelines", [])

    # Merge lineage from all pipelines
    all_nodes = []
    all_edges = []
    for p in pipelines:
        lineage = etl_service.build_lineage(p)
        all_nodes.extend(lineage.get("nodes", []))
        all_edges.extend(lineage.get("edges", []))

    # Deduplicate nodes by id
    seen = set()
    unique_nodes = []
    for n in all_nodes:
        if n["id"] not in seen:
            unique_nodes.append(n)
            seen.add(n["id"])

    return {"nodes": unique_nodes, "edges": all_edges}


@router.delete("/pipelines/{agent_id}/{pipeline_id}")
async def delete_pipeline(
    agent_id: str,
    pipeline_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """Delete a pipeline from workspace config."""
    r = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")
    config = agent.workspace_config or {}
    pipelines = config.get("pipelines", [])
    config["pipelines"] = [p for p in pipelines if p.get("id") != pipeline_id]
    agent.workspace_config = config
    await db.commit()
    return {"ok": True}
