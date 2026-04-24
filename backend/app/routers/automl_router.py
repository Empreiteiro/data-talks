"""
Auto ML router: train models, list/get/delete runs.
"""
import uuid
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.config import get_settings
from app.database import get_db
from app.models import Agent, AutoMLRun, LlmConfig, LlmSettings, Source, User
from app.scripts.automl import run_automl

router = APIRouter(prefix="/automl", tags=["automl"])

MAX_ROWS = 100_000


def _user_llm_overrides(llm_row: LlmSettings | LlmConfig | None) -> dict | None:
    if not llm_row:
        return None
    overrides = {}
    if getattr(llm_row, "llm_provider", None):
        overrides["llm_provider"] = llm_row.llm_provider
    if getattr(llm_row, "openai_api_key", None):
        overrides["openai_api_key"] = llm_row.openai_api_key
    if getattr(llm_row, "openai_base_url", None):
        overrides["openai_base_url"] = llm_row.openai_base_url
    if getattr(llm_row, "openai_model", None):
        overrides["openai_model"] = llm_row.openai_model
    if getattr(llm_row, "ollama_base_url", None):
        overrides["ollama_base_url"] = llm_row.ollama_base_url
    if getattr(llm_row, "ollama_model", None):
        overrides["ollama_model"] = llm_row.ollama_model
    if getattr(llm_row, "litellm_base_url", None):
        overrides["litellm_base_url"] = llm_row.litellm_base_url
    if getattr(llm_row, "litellm_model", None):
        overrides["litellm_model"] = llm_row.litellm_model
    if getattr(llm_row, "litellm_api_key", None):
        overrides["litellm_api_key"] = llm_row.litellm_api_key
    return overrides if overrides else None


async def _resolve_llm_overrides(db: AsyncSession, user: User, agent: Agent) -> dict | None:
    """Resolve LLM config: agent-level config > user settings > env."""
    if agent.llm_config_id:
        r = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        config = r.scalar_one_or_none()
        if config:
            return _user_llm_overrides(config)
    r = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    return _user_llm_overrides(r.scalar_one_or_none())


def _load_source_dataframe(source: Source) -> pd.DataFrame:
    """Load a DataFrame from the source metadata."""
    from app.services.storage import get_storage
    meta = source.metadata_ or {}

    if source.type in ("csv", "xlsx"):
        file_path = meta.get("file_path")
        if not file_path:
            raise HTTPException(400, "CSV/XLSX source missing file_path in metadata")
        full_path = get_storage().local_path(file_path)
        if not full_path.exists():
            raise HTTPException(400, f"Data file not found: {file_path}")
        ext = full_path.suffix.lower()
        if ext == ".csv":
            return pd.read_csv(full_path, nrows=MAX_ROWS)
        return pd.read_excel(full_path, nrows=MAX_ROWS)

    if source.type == "sql_database":
        connection_string = meta.get("connectionString") or meta.get("connection_string")
        if not connection_string:
            raise HTTPException(400, "SQL source missing connectionString")
        table_infos = meta.get("table_infos", [])
        if not table_infos:
            raise HTTPException(400, "SQL source has no table info")
        table_name = table_infos[0].get("table", "")
        if not table_name:
            raise HTTPException(400, "SQL source has no table name")
        return pd.read_sql_table(table_name, connection_string)

    raise HTTPException(400, f"Auto ML is not yet supported for source type: {source.type}. Supported: csv, xlsx, sql_database.")


def _get_columns_from_source(source: Source) -> list[str]:
    """Extract column names from source metadata."""
    meta = source.metadata_ or {}

    if source.type in ("csv", "xlsx"):
        cols = meta.get("columns")
        if cols:
            return cols
        # Fallback: load file header
        file_path = meta.get("file_path")
        if file_path:
            from app.services.storage import get_storage
            full_path = get_storage().local_path(file_path)
            if full_path.exists():
                ext = full_path.suffix.lower()
                if ext == ".csv":
                    df = pd.read_csv(full_path, nrows=0)
                else:
                    df = pd.read_excel(full_path, nrows=0)
                return list(df.columns)
        return []

    if source.type == "sql_database":
        table_infos = meta.get("table_infos", [])
        if table_infos:
            return table_infos[0].get("columns", [])
        return meta.get("availableColumns", [])

    if source.type == "bigquery":
        table_infos = meta.get("table_infos", [])
        if table_infos:
            return table_infos[0].get("columns", [])
        return []

    if source.type == "google_sheets":
        return meta.get("availableColumns") or meta.get("available_columns") or []

    return []


# -- Schemas --

class TrainRequest(BaseModel):
    agentId: str
    sourceId: str
    targetColumn: str


class ColumnsRequest(BaseModel):
    pass  # query params only


# -- Endpoints --

@router.post("/train")
async def train_automl(
    body: TrainRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Train an Auto ML model on the selected source and target column."""
    r = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    r = await db.execute(
        select(Source).where(Source.id == body.sourceId, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    llm_overrides = await _resolve_llm_overrides(db, user, agent)

    df = _load_source_dataframe(source)
    result = await run_automl(
        df=df,
        target_column=body.targetColumn,
        llm_overrides=llm_overrides,
        channel="studio",
    )

    run_id = str(uuid.uuid4())
    run = AutoMLRun(
        id=run_id,
        user_id=user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=source.name,
        target_column=body.targetColumn,
        task_type=result["task_type"],
        model_type=result["model_type"],
        metrics=result["metrics"],
        feature_importance=result["feature_importance"],
        report=result["report"],
    )
    db.add(run)
    await db.commit()

    return _run_to_dict(run)


@router.get("/columns")
async def get_columns(
    agent_id: str,
    source_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Return column names for the given source."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    columns = _get_columns_from_source(source)
    return {"columns": columns}


@router.get("")
async def list_runs(
    agent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """List Auto ML runs, optionally filtered by workspace."""
    q = (
        select(AutoMLRun)
        .where(AutoMLRun.user_id == user.id)
        .order_by(AutoMLRun.created_at.desc())
    )
    if agent_id:
        q = q.where(AutoMLRun.agent_id == agent_id)
    r = await db.execute(q)
    return [_run_to_dict(run) for run in r.scalars().all()]


@router.get("/{run_id}")
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Get a single Auto ML run."""
    r = await db.execute(
        select(AutoMLRun).where(AutoMLRun.id == run_id, AutoMLRun.user_id == user.id)
    )
    run = r.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")
    return _run_to_dict(run)


@router.delete("/{run_id}")
async def delete_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Delete an Auto ML run."""
    r = await db.execute(
        select(AutoMLRun).where(AutoMLRun.id == run_id, AutoMLRun.user_id == user.id)
    )
    run = r.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")
    await db.delete(run)
    await db.commit()
    return {"ok": True}


def _run_to_dict(run: AutoMLRun) -> dict:
    return {
        "id": run.id,
        "agentId": run.agent_id,
        "sourceId": run.source_id,
        "sourceName": run.source_name,
        "targetColumn": run.target_column,
        "taskType": run.task_type,
        "modelType": run.model_type,
        "metrics": run.metrics,
        "featureImportance": run.feature_importance,
        "report": run.report,
        "createdAt": run.created_at.isoformat(),
    }
