"""CDP (Customer Data Platform) API — identity resolution, enrichment, segmentation, materialization."""
from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import Any, Optional

import pandas as pd
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


class MaterializeRequest(BaseModel):
    agentId: str
    sql: str  # The SQL to execute (from identity_resolution, enrichment, or segmentation)
    tableName: str = "unified_customers"  # Name for the output CSV


def _make_table_name_from_source(name: str) -> str:
    """Convert source filename to SQLite table name."""
    import re
    n = name.rsplit(".", 1)[0]
    n = re.sub(r"[^a-zA-Z0-9_]", "_", n)
    n = re.sub(r"_+", "_", n).strip("_")
    return n.lower() or "data"


@router.post("/materialize")
async def materialize_cdp_table(
    body: MaterializeRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute CDP SQL against all workspace sources and save result as a new CSV source."""
    from app.scripts.ask_csv import _load_full_dataframe
    from app.routers.crud import _build_sample_profile, _sanitize_for_json

    r = await db.execute(select(Agent).where(Agent.id == body.agentId, Agent.user_id == user.id))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")

    from app.services.storage import get_storage
    storage = get_storage()

    # Load ALL workspace sources into in-memory SQLite (active + materialized)
    from sqlalchemy import or_
    source_ids = agent.source_ids or []
    r_src = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            or_(
                Source.agent_id == agent.id,
                Source.id.in_(source_ids) if source_ids else Source.agent_id == agent.id,
            ),
        )
    )
    sources = list(r_src.scalars().all())
    if not sources:
        raise HTTPException(400, "No sources found")

    conn = sqlite3.connect(":memory:")
    loaded_tables = []
    for src in sources:
        meta = src.metadata_ or {}
        file_path = meta.get("file_path", "")
        if not file_path:
            continue
        full_path = storage.local_path(file_path)
        if not full_path.exists():
            continue
        try:
            df = _load_full_dataframe(full_path)
            tname = _make_table_name_from_source(src.name)
            df.to_sql(tname, conn, index=False, if_exists="replace")
            loaded_tables.append(tname)
        except Exception:
            continue

    # Extract SELECT from "CREATE TABLE ... AS SELECT ..." if present
    import re
    sql = body.sql.strip().rstrip(";")
    # Strip CREATE TABLE wrapper (handles quoted and unquoted table names)
    match = re.match(r"(?i)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"']?[\w]+[\"']?\s+AS\s+", sql)
    if match:
        sql = sql[match.end():]

    # Execute the SELECT
    try:
        result_df = pd.read_sql_query(sql, conn)
    except Exception as e:
        available = ", ".join(loaded_tables) if loaded_tables else "none"
        raise HTTPException(400, f"SQL error: {e}. Available tables: {available}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if result_df.empty:
        raise HTTPException(400, "Query returned no results")

    # Save as new CSV file via the storage abstraction so it lands on S3
    # when configured. We first materialize to a local cache path so pandas
    # can write directly to disk, then hand the bytes to storage to mirror
    # the write to S3.
    output_filename = f"{user.id}/{uuid.uuid4().hex[:8]}_{body.tableName}.csv"
    import io as _io
    buf = _io.BytesIO()
    result_df.to_csv(buf, index=False)
    storage.write_bytes(output_filename, buf.getvalue())
    output_path = storage.local_path(output_filename)

    # Build metadata
    profile = _build_sample_profile(result_df.head(1000))
    metadata = {
        "file_path": output_filename,
        "columns": [str(c) for c in result_df.columns],
        "preview_rows": _sanitize_for_json(result_df.head(5).to_dict(orient="records")),
        "row_count": len(result_df),
        "sample_row_count": min(len(result_df), 1000),
        "sample_profile": profile,
    }

    # Create new Source in DB
    source = Source(
        id=str(uuid.uuid4()),
        user_id=user.id,
        organization_id=user.organization_id or user.id,
        agent_id=agent.id,
        name=f"{body.tableName}.csv",
        type="csv",
        metadata_=metadata,
        is_active=True,
    )
    db.add(source)

    # Update agent source_ids
    source_ids = list(agent.source_ids or [])
    source_ids.append(source.id)
    agent.source_ids = source_ids

    await db.commit()

    return {
        "sourceId": source.id,
        "sourceName": source.name,
        "rowCount": len(result_df),
        "columns": list(result_df.columns),
    }
