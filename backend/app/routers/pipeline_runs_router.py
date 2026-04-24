"""Read-only endpoints over `PipelineRun` and `LineageEdge`.

Used by the ETL workspace UI to show the execution history, detail a single
run, and aggregate a lineage graph across runs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership
from app.database import get_db
from app.models import LineageEdge, PipelineRun
from app.services.lineage import build_lineage_graph
from app.services.tenant_scope import tenant_filter


router = APIRouter(prefix="/pipeline-runs", tags=["pipeline-runs"])


def _run_to_dict(run: PipelineRun) -> dict:
    return {
        "id": run.id,
        "agent_id": run.agent_id,
        "pipeline_id": run.pipeline_id,
        "kind": run.kind,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "duration_ms": run.duration_ms,
        "error_message": run.error_message,
        "metadata": run.metadata_ or {},
    }


def _edge_to_dict(edge: LineageEdge) -> dict:
    return {
        "id": edge.id,
        "run_id": edge.run_id,
        "source_kind": edge.source_kind,
        "source_ref": edge.source_ref,
        "target_kind": edge.target_kind,
        "target_ref": edge.target_ref,
        "edge_type": edge.edge_type,
        "metadata": edge.metadata_ or {},
    }


@router.get("")
async def list_runs(
    agent_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> list[dict]:
    q = select(PipelineRun).where(tenant_filter(PipelineRun, scope))
    if agent_id:
        q = q.where(PipelineRun.agent_id == agent_id)
    if kind:
        q = q.where(PipelineRun.kind == kind)
    if status:
        q = q.where(PipelineRun.status == status)
    if since:
        q = q.where(PipelineRun.started_at >= since)
    if until:
        q = q.where(PipelineRun.started_at <= until)
    q = q.order_by(PipelineRun.started_at.desc()).limit(limit)
    r = await db.execute(q)
    return [_run_to_dict(run) for run in r.scalars().all()]


@router.get("/{run_id}")
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> dict:
    r = await db.execute(
        select(PipelineRun).where(
            PipelineRun.id == run_id, tenant_filter(PipelineRun, scope)
        )
    )
    run = r.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")

    r2 = await db.execute(
        select(LineageEdge).where(LineageEdge.run_id == run_id).order_by(LineageEdge.created_at)
    )
    edges = list(r2.scalars().all())
    return {
        **_run_to_dict(run),
        "edges": [_edge_to_dict(e) for e in edges],
    }


@router.get("/lineage/agent/{agent_id}")
async def agent_lineage(
    agent_id: str,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> dict:
    """Aggregate lineage graph from the most recent runs for an agent."""
    runs_q = (
        select(PipelineRun.id)
        .where(tenant_filter(PipelineRun, scope), PipelineRun.agent_id == agent_id)
        .order_by(PipelineRun.started_at.desc())
        .limit(limit)
    )
    r = await db.execute(runs_q)
    run_ids = [row for row in r.scalars().all()]
    if not run_ids:
        return {"nodes": [], "edges": []}

    edges_q = select(LineageEdge).where(LineageEdge.run_id.in_(run_ids))
    r2 = await db.execute(edges_q)
    edges = list(r2.scalars().all())
    return build_lineage_graph(edges)
