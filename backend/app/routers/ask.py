"""
POST /api/ask-question: routes to the correct script (CSV, Google Sheets, SQL, BigQuery).
Compatible with frontend payload (question, agentId, userId, sessionId).
"""
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.auth import require_user
from app.llm.charting import build_chart_plan, render_chart
from app.models import Agent, Source, QASession, LlmSettings, LlmConfig
from app.models import User
from app.schemas import AskQuestionRequest, AskQuestionResponse
from app.scripts.ask_csv import ask_csv
from app.scripts.ask_bigquery import ask_bigquery
from app.scripts.ask_google_sheets import ask_google_sheets
from app.scripts.ask_sql import ask_sql

router = APIRouter(prefix="/ask-question", tags=["ask"])


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


class GenerateChartRequest(BaseModel):
    turnId: str | None = None
    turnIndex: int | None = None


def _chart_image_url(session_id: str, turn_id: str) -> str:
    prefix = get_settings().api_prefix.rstrip("/")
    return f"{prefix}/ask-question/{session_id}/chart/{turn_id}/image"


def _chart_file_path(user_id: str, session_id: str, turn_id: str) -> tuple[str, Path]:
    relative_path = f"charts/{user_id}/{session_id}-{turn_id}.png"
    full_path = Path(get_settings().data_files_dir) / relative_path
    return relative_path, full_path


def _find_turn(history: list[dict], turn_id: str | None, turn_index: int | None) -> tuple[int, dict]:
    if turn_id:
        for index, item in enumerate(history):
            if item.get("id") == turn_id:
                return index, item
    if turn_index is not None and 0 <= turn_index < len(history):
        return turn_index, history[turn_index]
    raise HTTPException(404, "Conversation turn not found")


@router.post("", response_model=AskQuestionResponse)
async def ask_question(
    body: AskQuestionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    channel = body.channel or "workspace"
    if not body.agentId:
        raise HTTPException(400, "agentId is required")

    # Load agent
    r = await db.execute(select(Agent).where(Agent.id == body.agentId))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Agent sources: by source_ids on agent or by agent_id on source
    if agent.source_ids:
        r = await db.execute(select(Source).where(Source.id.in_(agent.source_ids)))
        sources = list(r.scalars().all())
    else:
        r = await db.execute(select(Source).where(Source.agent_id == body.agentId))
        sources = list(r.scalars().all())

    if not sources:
        raise HTTPException(400, "No active source found for this workspace")

    active_sources = [s for s in sources if s.is_active]
    source = active_sources[0] if active_sources else sources[0]
    settings = get_settings()
    data_files_dir = settings.data_files_dir

    # LLM overrides: agent.llm_config_id > LlmSettings (default) > env
    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)
    if llm_overrides is None:
        r_llm = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
        llm_row = r_llm.scalar_one_or_none()
        llm_overrides = _llm_config_to_overrides(llm_row)

    # Retrieve History
    history = []
    session_id = body.sessionId
    if session_id:
        r_qa = await db.execute(select(QASession).where(QASession.id == session_id))
        qa_session = r_qa.scalar_one_or_none()
        if qa_session and qa_session.conversation_history:
            history = qa_session.conversation_history

    # Route by source type
    if source.type in ("csv", "xlsx"):
        file_path = (source.metadata_ or {}).get("file_path")
        if not file_path:
            raise HTTPException(400, "CSV/XLSX source missing file_path in metadata")
        meta = source.metadata_ or {}
        result = await ask_csv(
            file_path=file_path,
            question=body.question,
            agent_description=agent.description or "",
            source_name=source.name,
            columns=meta.get("columns"),
            preview_rows=meta.get("preview_rows"),
            sample_profile=meta.get("sample_profile"),
            sample_row_count=meta.get("sample_row_count") or meta.get("row_count"),
            data_files_dir=data_files_dir,
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "google_sheets":
        meta = source.metadata_ or {}
        result = await ask_google_sheets(
            spreadsheet_id=meta.get("spreadsheetId", ""),
            sheet_name=meta.get("sheetName", "Sheet1"),
            available_columns=meta.get("availableColumns") or meta.get("available_columns"),
            question=body.question,
            agent_description=agent.description or "",
            source_name=source.name,
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "sql_database":
        meta = source.metadata_ or {}
        result = await ask_sql(
            connection_string=meta.get("connectionString", ""),
            question=body.question,
            agent_description=agent.description or "",
            source_name=source.name,
            table_infos=meta.get("table_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "bigquery":
        meta = source.metadata_ or {}
        creds = meta.get("credentialsContent") or meta.get("credentials_content")
        if not creds:
            raise HTTPException(400, "BigQuery source missing credentialsContent in metadata")
        result = await ask_bigquery(
            credentials_content=creds,
            project_id=meta.get("projectId", ""),
            dataset_id=meta.get("datasetId", ""),
            tables=meta.get("tables", []),
            question=body.question,
            agent_description=agent.description or "",
            source_name=source.name,
            table_infos=meta.get("table_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    else:
        raise HTTPException(400, f"Unsupported source type: {source.type}")

    turn_id = str(uuid.uuid4())
    conversation_entry = {
        "id": turn_id,
        "question": body.question,
        "answer": result["answer"],
        "imageUrl": result.get("imageUrl"),
        "followUpQuestions": result.get("followUpQuestions", []),
        "chartInput": result.get("chartInput"),
        "chartSpec": result.get("chartSpec"),
        "chartScript": result.get("chartScript"),
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Create or update QA session in SQLite
    session_id = body.sessionId
    if session_id:
        r = await db.execute(select(QASession).where(QASession.id == session_id))
        qa = r.scalar_one_or_none()
        if qa:
            history = [*(qa.conversation_history or []), conversation_entry]
            qa.conversation_history = history
            qa.follow_up_questions = result.get("followUpQuestions", [])
            if result.get("imageUrl"):
                qa.table_data = {
                    **(qa.table_data or {}),
                    "image_url": result.get("imageUrl"),
                    "last_turn_id": turn_id,
                }
            await db.flush()
            session_id = str(qa.id)
        else:
            session_id = None
    if not session_id:
        qa = QASession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            agent_id=body.agentId,
            source_id=source.id,
            question=body.question,
            answer=result["answer"],
            table_data=(
                {
                    "image_url": result.get("imageUrl"),
                    "last_turn_id": turn_id,
                }
                if result.get("imageUrl")
                else None
            ),
            follow_up_questions=result.get("followUpQuestions", []),
            conversation_history=[conversation_entry],
        )
        db.add(qa)
        await db.flush()
        session_id = qa.id

    await db.commit()

    return AskQuestionResponse(
        answer=result["answer"],
        imageUrl=result.get("imageUrl"),
        sessionId=session_id,
        followUpQuestions=result.get("followUpQuestions", []),
        turnId=turn_id,
        chartInput=result.get("chartInput"),
    )


@router.post("/{session_id}/chart")
async def generate_chart_for_turn(
    session_id: str,
    body: GenerateChartRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    r = await db.execute(select(QASession).where(QASession.id == session_id, QASession.user_id == user.id))
    qa = r.scalar_one_or_none()
    if not qa:
        raise HTTPException(404, "Session not found")

    history = list(qa.conversation_history or [])
    turn_index, turn = _find_turn(history, body.turnId, body.turnIndex)
    turn_id = str(turn.get("id") or body.turnId or turn_index)

    if turn.get("imageUrl") and turn.get("chartScript"):
        return {
            "imageUrl": turn["imageUrl"],
            "matplotlibScript": turn["chartScript"],
            "chartSpec": turn.get("chartSpec"),
            "turnId": turn_id,
        }

    agent_row = await db.execute(select(Agent).where(Agent.id == qa.agent_id))
    agent = agent_row.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)
    if llm_overrides is None:
        r_llm = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
        llm_row = r_llm.scalar_one_or_none()
        llm_overrides = _llm_config_to_overrides(llm_row)

    plan = await build_chart_plan(
        question=str(turn.get("question") or qa.question or ""),
        answer=str(turn.get("answer") or qa.answer or ""),
        chart_input=turn.get("chartInput"),
        llm_overrides=llm_overrides,
    )
    if not plan:
        raise HTTPException(400, "Could not derive a reliable chart from this answer")

    _, full_path = _chart_file_path(user.id, session_id, turn_id)
    script = render_chart(plan, full_path)
    image_url = _chart_image_url(session_id, turn_id)

    updated_turn = {
        **turn,
        "id": turn_id,
        "imageUrl": image_url,
        "chartSpec": plan,
        "chartScript": script,
    }
    updated_history = [*history[:turn_index], updated_turn, *history[turn_index + 1 :]]
    qa.conversation_history = updated_history
    qa.table_data = {
        **(qa.table_data or {}),
        "image_url": image_url,
        "last_turn_id": turn_id,
    }
    await db.commit()

    return {
        "imageUrl": image_url,
        "matplotlibScript": script,
        "chartSpec": plan,
        "turnId": turn_id,
    }


@router.get("/{session_id}/chart/{turn_id}/image")
async def get_chart_image(
    session_id: str,
    turn_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    r = await db.execute(select(QASession).where(QASession.id == session_id, QASession.user_id == user.id))
    qa = r.scalar_one_or_none()
    if not qa:
        raise HTTPException(404, "Session not found")

    history = qa.conversation_history or []
    _find_turn(history, turn_id, None)
    _, full_path = _chart_file_path(user.id, session_id, turn_id)
    if not full_path.exists():
        raise HTTPException(404, "Chart image not found")

    filename = f"chart-{turn_id}.png"
    return FileResponse(path=str(full_path), media_type="image/png", filename=filename)
