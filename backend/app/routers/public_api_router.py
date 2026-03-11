"""
Public API: POST /api/v1/ask
Authenticates via X-API-Key header.
Routes to the same ask scripts as the internal ask.py router.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import get_api_key_user
from app.models import User, Agent, Source, QASession, LlmConfig, ApiKey
from app.schemas import PublicAskRequest, AskQuestionResponse
from app.config import get_settings
from app.routers.ask import _llm_config_to_overrides, _build_active_multi_sql_sources
from app.scripts.ask_csv import ask_csv
from app.scripts.ask_bigquery import ask_bigquery
from app.scripts.ask_google_sheets import ask_google_sheets
from app.scripts.ask_sql import ask_sql
from app.scripts.ask_sql_multi import ask_sql_multi_source

router = APIRouter(prefix="/v1", tags=["public-api"])


@router.post("/ask", response_model=AskQuestionResponse)
async def public_ask(
    body: PublicAskRequest,
    db: AsyncSession = Depends(get_db),
    auth: tuple[User, ApiKey] = Depends(get_api_key_user),
):
    user, api_key = auth
    agent_id = api_key.agent_id
    channel = "api"

    # Load agent
    r = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Load all agent sources
    if agent.source_ids:
        r = await db.execute(select(Source).where(Source.id.in_(agent.source_ids)))
        all_sources = list(r.scalars().all())
    else:
        r = await db.execute(select(Source).where(Source.agent_id == agent_id))
        all_sources = list(r.scalars().all())

    if not all_sources:
        raise HTTPException(400, "No sources found for this agent")

    # Apply source_ids filter from request
    if body.source_ids:
        agent_source_id_set = {s.id for s in all_sources}
        invalid = set(body.source_ids) - agent_source_id_set
        if invalid:
            raise HTTPException(400, f"Source IDs not found on this agent: {list(invalid)}")
        sources = [s for s in all_sources if s.id in set(body.source_ids)]
    else:
        sources = all_sources

    if not sources:
        raise HTTPException(400, "No matching sources for the given source_ids")

    # SQL mode: request override > agent default
    sql_mode = body.sql_mode if body.sql_mode is not None else getattr(agent, "sql_mode", False)

    # LLM overrides
    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(
            select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id)
        )
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)

    # Retrieve history
    history: list[dict] = []
    session_id = body.session_id
    if session_id:
        r_qa = await db.execute(select(QASession).where(QASession.id == session_id))
        qa_session = r_qa.scalar_one_or_none()
        if qa_session and qa_session.conversation_history:
            history = qa_session.conversation_history

    settings = get_settings()
    data_files_dir = settings.data_files_dir

    # Multi-SQL check
    multi_sql_sources, multi_sql_relationships = _build_active_multi_sql_sources(agent, sources)
    active_sources = [s for s in sources if s.is_active]
    source = active_sources[0] if active_sources else sources[0]

    # Route by source type (same logic as ask.py)
    if len(multi_sql_sources) >= 2:
        result = await ask_sql_multi_source(
            sources=multi_sql_sources,
            relationships=multi_sql_relationships,
            question=body.question,
            agent_description=agent.description or "",
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type in ("csv", "xlsx"):
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
            sql_mode=sql_mode,
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
            sql_mode=sql_mode,
        )
    else:
        raise HTTPException(400, f"Unsupported source type: {source.type}")

    # Save QA session
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

    if session_id:
        r = await db.execute(select(QASession).where(QASession.id == session_id))
        qa = r.scalar_one_or_none()
        if qa:
            updated_history = [*(qa.conversation_history or []), conversation_entry]
            qa.conversation_history = updated_history
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
            agent_id=agent_id,
            source_id=source.id,
            question=body.question,
            answer=result["answer"],
            table_data=(
                {"image_url": result.get("imageUrl"), "last_turn_id": turn_id}
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
