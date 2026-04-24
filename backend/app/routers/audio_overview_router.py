"""
Studio Audio: generate, list, fetch, and delete concise audio overviews for a source.
"""
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.config import get_settings
from app.database import get_db
from app.llm.client import chat_completion, get_audio_model, synthesize_speech
from app.models import Agent, AudioOverview, LlmConfig, LlmSettings, Source, User
from app.scripts.summary_bigquery import generate_table_summary_bigquery
from app.scripts.summary_csv import generate_table_summary_csv
from app.scripts.summary_google_sheets import generate_table_summary_google_sheets
from app.scripts.summary_sql import generate_table_summary_sql

router = APIRouter(prefix="/audio_overviews", tags=["audio"])

MAX_SCRIPT_WORDS = 110


class GenerateAudioOverviewRequest(BaseModel):
    agentId: str
    sourceId: Optional[str] = None


def _llm_config_to_overrides(cfg: LlmConfig | LlmSettings | None) -> dict | None:
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
    if getattr(cfg, "openai_audio_model", None):
        overrides["openai_audio_model"] = cfg.openai_audio_model
    if getattr(cfg, "ollama_base_url", None):
        overrides["ollama_base_url"] = cfg.ollama_base_url
    if getattr(cfg, "ollama_model", None):
        overrides["ollama_model"] = cfg.ollama_model
    if getattr(cfg, "litellm_base_url", None):
        overrides["litellm_base_url"] = cfg.litellm_base_url
    if getattr(cfg, "litellm_model", None):
        overrides["litellm_model"] = cfg.litellm_model
    if getattr(cfg, "litellm_audio_model", None):
        overrides["litellm_audio_model"] = cfg.litellm_audio_model
    if getattr(cfg, "litellm_api_key", None):
        overrides["litellm_api_key"] = cfg.litellm_api_key
    return overrides if overrides else None


async def _effective_llm_overrides(db: AsyncSession, user: User, agent: Agent) -> dict | None:
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            return _llm_config_to_overrides(cfg)

    r_default = await db.execute(
        select(LlmConfig).where(LlmConfig.user_id == user.id, LlmConfig.is_default == True).limit(1)
    )
    default_cfg = r_default.scalar_one_or_none()
    if default_cfg:
        return _llm_config_to_overrides(default_cfg)

    r_llm = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    llm_row = r_llm.scalar_one_or_none()
    return _llm_config_to_overrides(llm_row)


async def _resolve_source(
    db: AsyncSession,
    scope: TenantScope,
    agent_id: str,
    source_id: str | None,
) -> Source:
    if source_id:
        r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
        source = r.scalar_one_or_none()
    else:
        r = await db.execute(
            select(Source).where(Source.agent_id == agent_id, tenant_filter(Source, scope), Source.is_active == True)
        )
        source = r.scalar_one_or_none()
        if not source:
            r = await db.execute(select(Source).where(Source.agent_id == agent_id, tenant_filter(Source, scope)))
            source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(400, "No source found for this workspace")
    return source


async def _generate_source_summary_report(source: Source, llm_overrides: dict | None) -> str:
    settings = get_settings()
    meta = source.metadata_ or {}

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
        )
    elif source.type == "google_sheets":
        result = await generate_table_summary_google_sheets(
            spreadsheet_id=meta.get("spreadsheetId", "") or meta.get("spreadsheet_id", ""),
            sheet_name=meta.get("sheetName", "Sheet1") or meta.get("sheet_name", "Sheet1"),
            available_columns=meta.get("availableColumns") or meta.get("available_columns"),
            source_name=source.name,
            llm_overrides=llm_overrides,
        )
    else:
        raise HTTPException(400, f"Audio overview not supported for source type: {source.type}")

    return (result.get("report") or "").strip()


def _normalize_audio_script(text: str) -> str:
    cleaned = re.sub(r"^[#*\-\s]+", "", (text or "").strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\s*\n+\s*", " ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    if not cleaned:
        return ""
    words = cleaned.split()
    if len(words) > MAX_SCRIPT_WORDS:
        cleaned = " ".join(words[:MAX_SCRIPT_WORDS]).rstrip(".,;:") + "."
    return cleaned


async def _build_audio_script(source_name: str, report: str, llm_overrides: dict | None) -> str:
    system = (
        "You are writing a concise spoken audio overview for a dataset. "
        "Rewrite the source summary into a short narration suitable for TTS. "
        "Return plain text only, with no markdown, bullets, headings, or labels. "
        "Keep it between 60 and 110 words, in one short paragraph, professional and natural to hear aloud."
    )
    user = (
        f"Source name: {source_name}\n\n"
        f"Summary report:\n{report}\n\n"
        "Write a concise audio overview now."
    )
    script, _, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=300,
        llm_overrides=llm_overrides,
    )
    normalized = _normalize_audio_script(script)
    if not normalized:
        raise HTTPException(500, "Could not generate a valid audio script")
    return normalized


@router.post("")
async def generate_audio_overview(
    body: GenerateAudioOverviewRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    if not body.agentId:
        raise HTTPException(400, "agentId is required")

    r = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    llm_overrides = await _effective_llm_overrides(db, scope.user, agent)
    provider, audio_model = get_audio_model(llm_overrides)
    if provider not in ("openai", "litellm") or not audio_model:
        raise HTTPException(
            400,
            "Configure an audio model in Account > LLM / AI settings for the current workspace model before generating audio.",
        )

    source = await _resolve_source(db, scope, body.agentId, body.sourceId)
    report = await _generate_source_summary_report(source, llm_overrides)
    script = await _build_audio_script(source.name, report, llm_overrides)
    audio_bytes, mime_type, _ = await synthesize_speech(script, llm_overrides=llm_overrides)

    from app.services.storage import get_storage
    audio_id = str(uuid.uuid4())
    ext = ".mp3" if mime_type == "audio/mpeg" else ".bin"
    relative_path = f"audio_overviews/{scope.user.id}/{audio_id}{ext}"
    get_storage().write_bytes(relative_path, audio_bytes)

    overview = AudioOverview(
        id=audio_id,
        user_id=scope.user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=source.name,
        script=script,
        audio_file_path=relative_path,
        mime_type=mime_type,
    )
    db.add(overview)
    await db.commit()

    return {
        "id": overview.id,
        "agentId": overview.agent_id,
        "sourceId": overview.source_id,
        "sourceName": overview.source_name,
        "script": overview.script,
        "mimeType": overview.mime_type,
        "createdAt": overview.created_at.isoformat(),
    }


@router.get("")
async def list_audio_overviews(
    agent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    q = select(AudioOverview).where(AudioOverview.user_id == scope.user.id).order_by(AudioOverview.created_at.desc())
    if agent_id:
        q = q.where(AudioOverview.agent_id == agent_id)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "id": row.id,
            "agentId": row.agent_id,
            "sourceId": row.source_id,
            "sourceName": row.source_name,
            "script": row.script,
            "mimeType": row.mime_type,
            "createdAt": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/{audio_id}/audio")
async def get_audio_file(
    audio_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(AudioOverview).where(AudioOverview.id == audio_id, AudioOverview.user_id == scope.user.id))
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Audio overview not found")

    from app.services.storage import get_storage
    full_path = get_storage().local_path(row.audio_file_path)
    if not full_path.exists():
        raise HTTPException(404, "Audio file not found")

    return FileResponse(path=str(full_path), media_type=row.mime_type, filename=f"{row.source_name}.mp3")


@router.delete("/{audio_id}")
async def delete_audio_overview(
    audio_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(AudioOverview).where(AudioOverview.id == audio_id, AudioOverview.user_id == scope.user.id))
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Audio overview not found")

    from app.services.storage import get_storage
    get_storage().delete(row.audio_file_path)

    await db.delete(row)
    await db.commit()
    return {"ok": True}
