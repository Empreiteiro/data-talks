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
from app.models import User, Agent, Source, TableSummary, LlmSettings
from app.auth import require_user
from app.scripts.summary_bigquery import generate_table_summary_bigquery


def _user_llm_overrides(llm_row: LlmSettings | None) -> dict | None:
    if not llm_row:
        return None
    overrides = {}
    if llm_row.llm_provider:
        overrides["llm_provider"] = llm_row.llm_provider
    if llm_row.openai_api_key:
        overrides["openai_api_key"] = llm_row.openai_api_key
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


router = APIRouter(prefix="/table_summaries", tags=["summary"])


class GenerateSummaryRequest(BaseModel):
    agentId: str
    sourceId: Optional[str] = None  # if omitted, use active source for agent


@router.post("")
async def generate_summary(
    body: GenerateSummaryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Generate a table summary (executive report) for the selected source. BigQuery only for now."""
    r = await db.execute(select(Agent).where(Agent.id == body.agentId))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Resolve source: by sourceId or active source for agent
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

    if source.type != "bigquery":
        raise HTTPException(400, "Table summary is only supported for BigQuery sources")

    meta = source.metadata_ or {}
    creds = meta.get("credentialsContent") or meta.get("credentials_content")
    if not creds:
        raise HTTPException(400, "BigQuery source missing credentials")

    # User LLM overrides
    r_llm = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    llm_row = r_llm.scalar_one_or_none()
    llm_overrides = _user_llm_overrides(llm_row)

    result = await generate_table_summary_bigquery(
        credentials_content=creds,
        project_id=meta.get("projectId", ""),
        dataset_id=meta.get("datasetId", ""),
        tables=meta.get("tables", []),
        table_infos=meta.get("table_infos"),
        source_name=source.name,
        llm_overrides=llm_overrides,
    )

    summary_id = str(uuid.uuid4())
    summary = TableSummary(
        id=summary_id,
        user_id=user.id,
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
    user: User = Depends(require_user),
):
    """List table summaries, optionally filtered by workspace (agent_id)."""
    q = select(TableSummary).where(TableSummary.user_id == user.id).order_by(TableSummary.created_at.desc())
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
    user: User = Depends(require_user),
):
    """Get a single table summary by id."""
    r = await db.execute(select(TableSummary).where(TableSummary.id == summary_id, TableSummary.user_id == user.id))
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
    user: User = Depends(require_user),
):
    """Delete a table summary."""
    r = await db.execute(select(TableSummary).where(TableSummary.id == summary_id, TableSummary.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Summary not found")
    await db.delete(s)
    await db.commit()
    return {"ok": True}
