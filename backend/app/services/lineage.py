"""Execution lineage tracker.

Call sites use the `tracked_run` async context manager to record a `PipelineRun`
row with start/finish timestamps, status, and error info. Edges between
source/target entities are recorded via `record_edge`.

Intentionally thin: the tracker swallows its own DB errors so instrumentation
failures never break the underlying business logic. Lineage is observability,
not an invariant.
"""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LineageEdge, PipelineRun


logger = logging.getLogger(__name__)


async def start_run(
    db: AsyncSession,
    *,
    user_id: str,
    organization_id: str | None = None,
    kind: str,
    agent_id: str | None = None,
    pipeline_id: str | None = None,
    metadata: dict | None = None,
) -> PipelineRun | None:
    """Record a new run in "running" state. Returns None on failure (never raises).

    `organization_id` falls back to `user_id` so guest mode (where users have no org)
    still produces a valid row.
    """
    try:
        run = PipelineRun(
            id=str(uuid.uuid4()),
            user_id=user_id,
            organization_id=organization_id or user_id,
            agent_id=agent_id,
            pipeline_id=pipeline_id,
            kind=kind,
            status="running",
            started_at=datetime.utcnow(),
            metadata_=metadata or {},
        )
        db.add(run)
        await db.flush()
        return run
    except Exception:  # noqa: BLE001 — instrumentation must not break callers
        logger.exception("Failed to start lineage run")
        return None


async def finish_run(
    db: AsyncSession,
    run: PipelineRun | None,
    *,
    status: str,
    error_message: str | None = None,
    metadata_extra: dict | None = None,
) -> None:
    """Finalize a run with status and duration."""
    if run is None:
        return
    try:
        run.status = status
        run.finished_at = datetime.utcnow()
        if run.started_at:
            delta = run.finished_at - run.started_at
            run.duration_ms = int(delta.total_seconds() * 1000)
        if error_message:
            run.error_message = error_message[:4000]
        if metadata_extra:
            merged = dict(run.metadata_ or {})
            merged.update(metadata_extra)
            run.metadata_ = merged
        await db.flush()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to finish lineage run")


async def record_edge(
    db: AsyncSession,
    run: PipelineRun | None,
    *,
    source_kind: str,
    source_ref: str,
    target_kind: str,
    target_ref: str,
    edge_type: str,
    metadata: dict | None = None,
) -> None:
    """Record a single lineage edge on the current run."""
    if run is None:
        return
    try:
        edge = LineageEdge(
            id=str(uuid.uuid4()),
            run_id=run.id,
            source_kind=source_kind,
            source_ref=source_ref[:512] if source_ref else "",
            target_kind=target_kind,
            target_ref=target_ref[:512] if target_ref else "",
            edge_type=edge_type,
            metadata_=metadata or {},
        )
        db.add(edge)
        await db.flush()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to record lineage edge")


@asynccontextmanager
async def tracked_run(
    db: AsyncSession,
    *,
    user_id: str,
    organization_id: str | None = None,
    kind: str,
    agent_id: str | None = None,
    pipeline_id: str | None = None,
    metadata: dict | None = None,
) -> AsyncIterator[PipelineRun | None]:
    """Context manager version of start_run/finish_run.

    Usage:
        async with tracked_run(db, user_id=user.id, organization_id=user.organization_id,
                               kind="qa", agent_id=agent.id) as run:
            await record_edge(db, run, ...)
            ... business logic ...

    Exceptions raised inside the block are captured on the run (status=error,
    error_message=str(exc)) and re-raised unchanged.
    """
    run = await start_run(
        db,
        user_id=user_id,
        organization_id=organization_id,
        kind=kind,
        agent_id=agent_id,
        pipeline_id=pipeline_id,
        metadata=metadata,
    )
    try:
        yield run
    except Exception as e:  # noqa: BLE001 — we re-raise
        await finish_run(db, run, status="error", error_message=str(e))
        raise
    else:
        await finish_run(db, run, status="success")


def build_lineage_graph(edges: list[LineageEdge]) -> dict[str, Any]:
    """Aggregate a list of edges into a deduped {nodes, edges} graph."""
    nodes: dict[str, dict] = {}
    out_edges: list[dict] = []

    def _node_key(kind: str, ref: str) -> str:
        return f"{kind}:{ref}"

    for e in edges:
        src_key = _node_key(e.source_kind, e.source_ref)
        tgt_key = _node_key(e.target_kind, e.target_ref)
        if src_key not in nodes:
            nodes[src_key] = {"id": src_key, "kind": e.source_kind, "ref": e.source_ref}
        if tgt_key not in nodes:
            nodes[tgt_key] = {"id": tgt_key, "kind": e.target_kind, "ref": e.target_ref}
        out_edges.append(
            {
                "id": e.id,
                "source": src_key,
                "target": tgt_key,
                "type": e.edge_type,
                "run_id": e.run_id,
            }
        )
    return {"nodes": list(nodes.values()), "edges": out_edges}
