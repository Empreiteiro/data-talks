"""
Studio Summary: generate and list table summaries (executive reports) for a workspace.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, Agent, Source, TableSummary, LlmSettings, LlmConfig
from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.config import get_settings
from app.scripts.summary_bigquery import generate_table_summary_bigquery
from app.scripts.summary_csv import generate_table_summary_csv
from app.scripts.summary_firebase import generate_table_summary_firebase
from app.scripts.summary_sql import generate_table_summary_sql
from app.scripts.summary_google_sheets import generate_table_summary_google_sheets


def _llm_config_to_overrides(cfg: LlmConfig | LlmSettings | None) -> dict | None:
    """Build overrides dict from LlmConfig or LlmSettings for chat_completion."""
    if not cfg:
        return None
    overrides = {}
    if cfg.llm_provider:
        overrides["llm_provider"] = cfg.llm_provider
    if getattr(cfg, "openai_api_key", None):
        overrides["openai_api_key"] = cfg.openai_api_key
    if getattr(cfg, "openai_base_url", None):
        overrides["openai_base_url"] = cfg.openai_base_url
    if getattr(cfg, "openai_model", None):
        overrides["openai_model"] = cfg.openai_model
    if getattr(cfg, "ollama_base_url", None):
        overrides["ollama_base_url"] = cfg.ollama_base_url
    if getattr(cfg, "ollama_model", None):
        overrides["ollama_model"] = cfg.ollama_model
    if getattr(cfg, "litellm_base_url", None):
        overrides["litellm_base_url"] = cfg.litellm_base_url
    if getattr(cfg, "litellm_model", None):
        overrides["litellm_model"] = cfg.litellm_model
    if getattr(cfg, "litellm_api_key", None):
        overrides["litellm_api_key"] = cfg.litellm_api_key
    return overrides if overrides else None


router = APIRouter(prefix="/table_summaries", tags=["summary"])


class GenerateSummaryRequest(BaseModel):
    agentId: str
    sourceId: Optional[str] = None  # if omitted, use active source for agent
    language: Optional[str] = None  # "en" | "pt" | "es" — output language


@router.post("")
async def generate_summary(
    body: GenerateSummaryRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Generate a table summary (executive report) for the selected source. BigQuery only for now."""
    r = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Resolve source: by sourceId or active source for agent
    if body.sourceId:
        r = await db.execute(select(Source).where(Source.id == body.sourceId, tenant_filter(Source, scope)))
        source = r.scalar_one_or_none()
    else:
        r = await db.execute(
            select(Source).where(Source.agent_id == body.agentId, tenant_filter(Source, scope), Source.is_active == True)
        )
        source = r.scalar_one_or_none()
        if not source:
            r = await db.execute(select(Source).where(Source.agent_id == body.agentId, tenant_filter(Source, scope)))
            source = r.scalar_one_or_none()

    if not source:
        raise HTTPException(400, "No source found for this workspace")

    meta = source.metadata_ or {}
    settings = get_settings()

    # LLM overrides: agent.llm_config_id > env (when "Default (env/config)")
    # Same resolution logic as the ask router
    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == scope.user.id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)
        else:
            raise HTTPException(400, "The LLM configuration assigned to this workspace no longer exists. Please update it in workspace settings.")

    if source.type == "bigquery":
        creds = meta.get("credentialsContent") or meta.get("credentials_content")
        if not creds:
            raise HTTPException(400, "BigQuery source missing credentials")
        result = await generate_table_summary_bigquery(
            credentials_content=creds,
            project_id=meta.get("projectId", ""),
            dataset_id=meta.get("datasetId", ""),
            tables=meta.get("tables", []),
            table_infos=meta.get("table_infos"),
            source_name=source.name,
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    elif source.type in ("csv", "xlsx"):
        file_path = meta.get("file_path")
        if not file_path:
            raise HTTPException(400, "CSV/XLSX source missing file_path in metadata")
        result = await generate_table_summary_csv(
            file_path=file_path,
            source_name=source.name,
            data_files_dir=settings.data_files_dir,
            columns=meta.get("columns"),
            preview_rows=meta.get("preview_rows"),
            sample_profile=meta.get("sample_profile"),
            sample_row_count=meta.get("sample_row_count") or meta.get("row_count"),
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    elif source.type == "sql_database":
        connection_string = meta.get("connectionString") or meta.get("connection_string")
        if not connection_string:
            raise HTTPException(400, "SQL source missing connectionString in metadata")
        table_infos = meta.get("table_infos")
        if not table_infos:
            raise HTTPException(400, "SQL source missing table_infos (schema) in metadata")
        result = await generate_table_summary_sql(
            connection_string=connection_string,
            table_infos=table_infos,
            source_name=source.name,
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    elif source.type == "google_sheets":
        result = await generate_table_summary_google_sheets(
            spreadsheet_id=meta.get("spreadsheetId", "") or meta.get("spreadsheet_id", ""),
            sheet_name=meta.get("sheetName", "Sheet1") or meta.get("sheet_name", "Sheet1"),
            available_columns=meta.get("availableColumns") or meta.get("available_columns"),
            source_name=source.name,
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    elif source.type == "firebase":
        creds = meta.get("credentialsContent") or meta.get("credentials_content")
        if not creds:
            raise HTTPException(400, "Firebase source missing credentials")
        result = await generate_table_summary_firebase(
            credentials_content=creds,
            project_id=meta.get("projectId", ""),
            collections=meta.get("collections", []),
            collection_infos=meta.get("collection_infos"),
            source_name=source.name,
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    else:
        raise HTTPException(400, f"Table summary not supported for source type: {source.type}")

    summary_id = str(uuid.uuid4())
    summary = TableSummary(
        id=summary_id,
        user_id=scope.user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=source.name,
        report=result["report"],
        queries_run=result.get("queries_run", []),
    )
    db.add(summary)
    await db.commit()

    return {
        "id": summary.id,
        "agentId": summary.agent_id,
        "sourceId": summary.source_id,
        "sourceName": summary.source_name,
        "report": summary.report,
        "queriesRun": summary.queries_run,
        "createdAt": summary.created_at.isoformat(),
    }


@router.get("")
async def list_summaries(
    agent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """List table summaries, optionally filtered by workspace (agent_id)."""
    q = select(TableSummary).where(TableSummary.user_id == scope.user.id).order_by(TableSummary.created_at.desc())
    if agent_id:
        q = q.where(TableSummary.agent_id == agent_id)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "id": s.id,
            "agentId": s.agent_id,
            "sourceId": s.source_id,
            "sourceName": s.source_name,
            "report": s.report,
            "queriesRun": s.queries_run,
            "createdAt": s.created_at.isoformat(),
        }
        for s in rows
    ]


@router.get("/{summary_id}")
async def get_summary(
    summary_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Get a single table summary by id."""
    r = await db.execute(select(TableSummary).where(TableSummary.id == summary_id, TableSummary.user_id == scope.user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Summary not found")
    return {
        "id": s.id,
        "agentId": s.agent_id,
        "sourceId": s.source_id,
        "sourceName": s.source_name,
        "report": s.report,
        "queriesRun": s.queries_run,
        "createdAt": s.created_at.isoformat(),
    }


@router.delete("/{summary_id}")
async def delete_summary(
    summary_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Delete a table summary."""
    r = await db.execute(select(TableSummary).where(TableSummary.id == summary_id, TableSummary.user_id == scope.user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Summary not found")
    await db.delete(s)
    await db.commit()
    return {"ok": True}
