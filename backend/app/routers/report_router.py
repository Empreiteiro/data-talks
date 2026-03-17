"""
Studio Report: generate and manage rich HTML reports with exploratory charts for a workspace.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, Agent, Source, Report, LlmSettings
from app.auth import require_user
from app.config import get_settings
from app.scripts.report_csv import generate_report_csv
from app.scripts.report_bigquery import generate_report_bigquery
from app.scripts.report_sql import generate_report_sql
from app.scripts.report_google_sheets import generate_report_google_sheets


def _user_llm_overrides(llm_row: LlmSettings | None) -> dict | None:
    if not llm_row:
        return None
    overrides = {}
    if llm_row.llm_provider:
        overrides["llm_provider"] = llm_row.llm_provider
    if llm_row.openai_api_key:
        overrides["openai_api_key"] = llm_row.openai_api_key
    if getattr(llm_row, "openai_base_url", None):
        overrides["openai_base_url"] = llm_row.openai_base_url
    if llm_row.openai_model:
        overrides["openai_model"] = llm_row.openai_model
    if llm_row.ollama_base_url:
        overrides["ollama_base_url"] = llm_row.ollama_base_url
    if llm_row.ollama_model:
        overrides["ollama_model"] = llm_row.ollama_model
    if llm_row.litellm_base_url:
        overrides["litellm_base_url"] = llm_row.litellm_base_url
    if llm_row.litellm_model:
        overrides["litellm_model"] = llm_row.litellm_model
    if llm_row.litellm_api_key:
        overrides["litellm_api_key"] = llm_row.litellm_api_key
    return overrides if overrides else None


def _validate_llm_config(llm_overrides: dict | None, settings) -> None:
    """Raise early if no LLM API key is available, before starting the multi-step pipeline."""
    provider = (llm_overrides or {}).get("llm_provider") or settings.llm_provider or "openai"
    if provider == "openai":
        key = (llm_overrides or {}).get("openai_api_key") or settings.openai_api_key or ""
        if not key.strip():
            raise HTTPException(
                400,
                "OpenAI API key is not configured. Please set your API key in Account > LLM / AI settings before generating a report.",
            )
    elif provider == "litellm":
        # LiteLLM may not need a key (local proxy), but base_url should be set
        base = (llm_overrides or {}).get("litellm_base_url") or settings.litellm_base_url or ""
        if not base.strip():
            raise HTTPException(
                400,
                "LiteLLM base URL is not configured. Please configure it in Account > LLM / AI settings.",
            )
    # Ollama doesn't need an API key


router = APIRouter(prefix="/reports", tags=["reports"])


class GenerateReportRequest(BaseModel):
    agentId: str
    sourceId: Optional[str] = None


@router.post("")
async def generate_report(
    body: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Generate a rich HTML report with exploratory charts for the selected source."""
    r = await db.execute(select(Agent).where(Agent.id == body.agentId))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Resolve source
    if body.sourceId:
        r = await db.execute(select(Source).where(Source.id == body.sourceId, Source.user_id == user.id))
        source = r.scalar_one_or_none()
    else:
        r = await db.execute(
            select(Source).where(Source.agent_id == body.agentId, Source.user_id == user.id, Source.is_active == True)
        )
        source = r.scalar_one_or_none()
        if not source:
            r = await db.execute(select(Source).where(Source.agent_id == body.agentId, Source.user_id == user.id))
            source = r.scalar_one_or_none()

    if not source:
        raise HTTPException(400, "No source found for this workspace")

    meta = source.metadata_ or {}
    r_llm = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    llm_row = r_llm.scalar_one_or_none()
    llm_overrides = _user_llm_overrides(llm_row)
    settings = get_settings()

    # Validate that an LLM API key is configured before starting the pipeline
    _validate_llm_config(llm_overrides, settings)

    try:
        if source.type in ("csv", "xlsx"):
            file_path = meta.get("file_path")
            if not file_path:
                raise HTTPException(400, "CSV/XLSX source missing file_path in metadata")
            result = await generate_report_csv(
                file_path=file_path,
                source_name=source.name,
                data_files_dir=settings.data_files_dir,
                llm_overrides=llm_overrides,
                channel="studio",
            )
        elif source.type == "bigquery":
            creds = meta.get("credentialsContent") or meta.get("credentials_content")
            if not creds:
                raise HTTPException(400, "BigQuery source missing credentials")
            result = await generate_report_bigquery(
                credentials_content=creds,
                project_id=meta.get("projectId", ""),
                dataset_id=meta.get("datasetId", ""),
                tables=meta.get("tables", []),
                table_infos=meta.get("table_infos"),
                source_name=source.name,
                llm_overrides=llm_overrides,
                channel="studio",
            )
        elif source.type == "sql_database":
            connection_string = meta.get("connectionString") or meta.get("connection_string")
            if not connection_string:
                raise HTTPException(400, "SQL source missing connectionString in metadata")
            table_infos = meta.get("table_infos")
            if not table_infos:
                raise HTTPException(400, "SQL source missing table_infos (schema) in metadata")
            result = await generate_report_sql(
                connection_string=connection_string,
                table_infos=table_infos,
                source_name=source.name,
                llm_overrides=llm_overrides,
                channel="studio",
            )
        elif source.type == "google_sheets":
            result = await generate_report_google_sheets(
                spreadsheet_id=meta.get("spreadsheetId", "") or meta.get("spreadsheet_id", ""),
                sheet_name=meta.get("sheetName", "Sheet1") or meta.get("sheet_name", "Sheet1"),
                source_name=source.name,
                llm_overrides=llm_overrides,
                channel="studio",
            )
        else:
            raise HTTPException(400, f"Report not supported for source type: {source.type}")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Report generation failed")
        raise HTTPException(500, f"Report generation failed: {exc}")

    report_id = str(uuid.uuid4())
    report = Report(
        id=report_id,
        user_id=user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=source.name,
        html_content=result["html_content"],
        chart_count=result.get("chart_count", 0),
    )
    db.add(report)
    await db.commit()

    return {
        "id": report.id,
        "agentId": report.agent_id,
        "sourceId": report.source_id,
        "sourceName": report.source_name,
        "chartCount": report.chart_count,
        "createdAt": report.created_at.isoformat(),
    }


@router.get("")
async def list_reports(
    agent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """List reports, optionally filtered by workspace (agent_id)."""
    q = select(Report).where(Report.user_id == user.id).order_by(Report.created_at.desc())
    if agent_id:
        q = q.where(Report.agent_id == agent_id)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "id": rpt.id,
            "agentId": rpt.agent_id,
            "sourceId": rpt.source_id,
            "sourceName": rpt.source_name,
            "chartCount": rpt.chart_count,
            "createdAt": rpt.created_at.isoformat(),
        }
        for rpt in rows
    ]


@router.get("/{report_id}")
async def get_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Get a single report by id (metadata only, no HTML content)."""
    r = await db.execute(select(Report).where(Report.id == report_id, Report.user_id == user.id))
    rpt = r.scalar_one_or_none()
    if not rpt:
        raise HTTPException(404, "Report not found")
    return {
        "id": rpt.id,
        "agentId": rpt.agent_id,
        "sourceId": rpt.source_id,
        "sourceName": rpt.source_name,
        "chartCount": rpt.chart_count,
        "createdAt": rpt.created_at.isoformat(),
    }


@router.get("/{report_id}/html")
async def get_report_html(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Serve the HTML content of a report (for iframe or download)."""
    r = await db.execute(select(Report).where(Report.id == report_id, Report.user_id == user.id))
    rpt = r.scalar_one_or_none()
    if not rpt:
        raise HTTPException(404, "Report not found")
    return HTMLResponse(content=rpt.html_content, media_type="text/html")


@router.delete("/{report_id}")
async def delete_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Delete a report."""
    r = await db.execute(select(Report).where(Report.id == report_id, Report.user_id == user.id))
    rpt = r.scalar_one_or_none()
    if not rpt:
        raise HTTPException(404, "Report not found")
    await db.delete(rpt)
    await db.commit()
    return {"ok": True}
