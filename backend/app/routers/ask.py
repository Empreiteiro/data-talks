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
from app.llm.charting import build_chart_plan
from app.models import Agent, Source, QASession, LlmSettings, LlmConfig
from app.models import User
from app.schemas import AskQuestionRequest, AskQuestionResponse
from app.scripts.ask_csv import ask_csv
from app.scripts.ask_bigquery import ask_bigquery
from app.scripts.ask_excel_online import ask_excel_online
from app.scripts.ask_rest_api import ask_rest_api
from app.scripts.ask_s3 import ask_s3
from app.scripts.ask_sqlite import ask_sqlite
from app.scripts.ask_dbt import ask_dbt
from app.scripts.ask_firebase import ask_firebase
from app.scripts.ask_github_file import ask_github_file
from app.scripts.ask_google_sheets import ask_google_sheets
from app.scripts.ask_mongodb import ask_mongodb
from app.scripts.ask_notion import ask_notion
from app.scripts.ask_snowflake import ask_snowflake
from app.scripts.ask_sql import ask_sql
from app.scripts.ask_sql_multi import ask_sql_multi_source
from app.scripts.sql_utils import validate_source_relationships

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


def _build_active_multi_sql_sources(agent: Agent, sources: list[Source]) -> tuple[list[dict], list[dict[str, str]]]:
    """Build multi-SQL sources when 2+ SQL sources exist. Includes ALL SQL sources (not only is_active)."""
    all_sql_sources = [source for source in sources if source.type == "sql_database"]
    if len(all_sql_sources) < 2:
        return [], []

    source_rows = [
        {
            "id": source.id,
            "name": source.name,
            "connection_string": (source.metadata_ or {}).get("connectionString", ""),
            "table_infos": (source.metadata_ or {}).get("table_infos") or [],
        }
        for source in all_sql_sources
    ]

    relationships = agent.source_relationships or []
    validated_relationships: list[dict[str, str]] = []
    if relationships:
        try:
            validated_relationships = validate_source_relationships(source_rows, relationships)
        except ValueError:
            pass

    if validated_relationships:
        related_source_ids = {
            r["leftSourceId"] for r in validated_relationships
        }.union({r["rightSourceId"] for r in validated_relationships})
        selected = [s for s in all_sql_sources if s.id in related_source_ids]
        if len(selected) < 2:
            selected = all_sql_sources
    else:
        selected = all_sql_sources

    selected_sources = []
    for source in selected:
        meta = source.metadata_ or {}
        selected_sources.append({
            "id": source.id,
            "name": source.name,
            "connectionString": meta.get("connectionString", ""),
            "table_infos": meta.get("table_infos") or [],
        })
    return selected_sources, validated_relationships


async def dispatch_question(
    question: str,
    agent: Agent,
    sources: list[Source],
    user: User,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    session_id: str | None = None,
    channel: str = "workspace",
    sql_mode: bool = False,
) -> dict:
    """Route question to the correct ask script, save QA session, return result.

    Returns dict with keys: answer, session_id, turn_id, follow_up_questions,
    image_url, chart_input.
    """
    if history is None:
        history = []

    multi_sql_sources, multi_sql_relationships = _build_active_multi_sql_sources(agent, sources)
    active_sources = [s for s in sources if s.is_active]
    source = active_sources[0] if active_sources else sources[0]
    settings = get_settings()
    data_files_dir = settings.data_files_dir

    # Route by source type
    if len(multi_sql_sources) >= 2:
        result = await ask_sql_multi_source(
            sources=multi_sql_sources,
            relationships=multi_sql_relationships,
            question=question,
            agent_description=agent.description or "",
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type in ("csv", "xlsx", "parquet", "json"):
        file_path = (source.metadata_ or {}).get("file_path")
        if not file_path:
            raise HTTPException(400, "CSV/XLSX source missing file_path in metadata")
        meta = source.metadata_ or {}
        result = await ask_csv(
            file_path=file_path,
            question=question,
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
    elif source.type == "sqlite":
        meta = source.metadata_ or {}
        file_path = meta.get("file_path")
        if not file_path:
            raise HTTPException(400, "SQLite source missing file_path in metadata")
        result = await ask_sqlite(
            file_path=file_path,
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            table_infos=meta.get("table_infos"),
            data_files_dir=data_files_dir,
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type == "google_sheets":
        meta = source.metadata_ or {}
        result = await ask_google_sheets(
            spreadsheet_id=meta.get("spreadsheetId", ""),
            sheet_name=meta.get("sheetName", "Sheet1"),
            available_columns=meta.get("availableColumns") or meta.get("available_columns"),
            question=question,
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
            question=question,
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
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            table_infos=meta.get("table_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type == "dbt":
        meta = source.metadata_ or {}
        result = await ask_dbt(
            project_source=meta.get("projectSource", "github"),
            connection_string=meta.get("connectionString", ""),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            github_token=meta.get("githubToken"),
            github_repo=meta.get("githubRepo", ""),
            github_branch=meta.get("githubBranch", "main"),
            manifest_path=meta.get("manifestPath", "target/manifest.json"),
            dbt_cloud_token=meta.get("dbtCloudToken"),
            dbt_cloud_account_id=str(meta.get("dbtCloudAccountId", "")),
            dbt_cloud_job_id=str(meta.get("dbtCloudJobId", "")),
            selected_models=meta.get("selectedModels") or None,
            table_infos=meta.get("table_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type == "github_file":
        meta = source.metadata_ or {}
        github_repo = meta.get("githubRepo", "")
        file_path = meta.get("filePath", "")
        if not github_repo or not file_path:
            raise HTTPException(400, "GitHub file source missing githubRepo or filePath in metadata")
        result = await ask_github_file(
            github_repo=github_repo,
            file_path=file_path,
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            github_token=meta.get("githubToken"),
            github_branch=meta.get("githubBranch", "main"),
            columns=meta.get("columns"),
            preview_rows=meta.get("preview_rows"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "firebase":
        meta = source.metadata_ or {}
        creds = meta.get("credentialsContent") or meta.get("credentials_content")
        if not creds:
            raise HTTPException(400, "Firebase source missing credentialsContent in metadata")
        result = await ask_firebase(
            credentials_content=creds,
            project_id=meta.get("projectId", ""),
            collections=meta.get("collections", []),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            collection_infos=meta.get("collection_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "mongodb":
        meta = source.metadata_ or {}
        conn_str = meta.get("connectionString")
        if not conn_str:
            raise HTTPException(400, "MongoDB source missing connectionString in metadata")
        result = await ask_mongodb(
            connection_string=conn_str,
            database=meta.get("database", ""),
            collection=meta.get("collection", ""),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            schema=meta.get("schema"),
            preview=meta.get("preview"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "excel_online":
        meta = source.metadata_ or {}
        excel_token = meta.get("accessToken")
        if not excel_token:
            raise HTTPException(400, "Excel Online source missing accessToken in metadata")
        result = await ask_excel_online(
            access_token=excel_token,
            drive_id=meta.get("driveId", ""),
            item_id=meta.get("itemId", ""),
            file_name=meta.get("fileName", ""),
            sheet_name=meta.get("sheetName", "Sheet1"),
            columns=meta.get("columns"),
            preview=meta.get("preview"),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "notion":
        meta = source.metadata_ or {}
        notion_token = meta.get("integrationToken")
        if not notion_token:
            raise HTTPException(400, "Notion source missing integrationToken in metadata")
        result = await ask_notion(
            integration_token=notion_token,
            database_id=meta.get("databaseId", ""),
            database_title=meta.get("databaseTitle", ""),
            properties=meta.get("properties"),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            preview=meta.get("preview"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "snowflake":
        meta = source.metadata_ or {}
        sf_account = meta.get("account", "")
        sf_user = meta.get("user", "")
        sf_password = meta.get("password", "")
        if not sf_account or not sf_user or not sf_password:
            raise HTTPException(400, "Snowflake source missing credentials in metadata")
        result = await ask_snowflake(
            account=sf_account,
            user=sf_user,
            password=sf_password,
            warehouse=meta.get("warehouse", ""),
            database=meta.get("database", ""),
            schema=meta.get("schema", ""),
            tables=meta.get("tables", []),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            table_infos=meta.get("table_infos"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
            sql_mode=sql_mode,
        )
    elif source.type == "rest_api":
        meta = source.metadata_ or {}
        api_url = meta.get("url", "")
        if not api_url:
            raise HTTPException(400, "REST API source missing url in metadata")
        result = await ask_rest_api(
            url=api_url,
            method=meta.get("method", "GET"),
            headers=meta.get("headers"),
            query_params=meta.get("queryParams"),
            body=meta.get("body"),
            data_path=meta.get("dataPath"),
            pagination=meta.get("pagination"),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            columns=meta.get("columns"),
            preview=meta.get("preview"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    elif source.type == "s3":
        meta = source.metadata_ or {}
        ak = meta.get("accessKeyId", "")
        sk = meta.get("secretAccessKey", "")
        if not ak or not sk:
            raise HTTPException(400, "S3 source missing credentials in metadata")
        result = await ask_s3(
            access_key_id=ak,
            secret_access_key=sk,
            region=meta.get("region", "us-east-1"),
            endpoint=meta.get("endpoint") or None,
            bucket=meta.get("bucket", ""),
            key=meta.get("key", ""),
            file_type=meta.get("fileType"),
            question=question,
            agent_description=agent.description or "",
            source_name=source.name,
            columns=meta.get("columns"),
            preview=meta.get("preview"),
            llm_overrides=llm_overrides,
            history=history,
            channel=channel,
        )
    else:
        raise HTTPException(400, f"Unsupported source type: {source.type}")

    # Save QA session
    turn_id = str(uuid.uuid4())
    conversation_entry = {
        "id": turn_id,
        "question": question,
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
            agent_id=agent.id,
            source_id=source.id,
            question=question,
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

    return {
        "answer": result["answer"],
        "image_url": result.get("imageUrl"),
        "session_id": session_id,
        "turn_id": turn_id,
        "follow_up_questions": result.get("followUpQuestions", []),
        "chart_input": result.get("chartInput"),
    }


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

    multi_sql_sources, multi_sql_relationships = _build_active_multi_sql_sources(agent, sources)
    active_sources = [s for s in sources if s.is_active]
    source = active_sources[0] if active_sources else sources[0]
    settings = get_settings()
    data_files_dir = settings.data_files_dir

    # LLM overrides: agent.llm_config_id > env (when "Default (env/config)") > LlmSettings
    # When workspace uses "Default (env/config)", llm_config_id is null -> prefer env so .env wins over stale LlmSettings
    llm_overrides = None
    if agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_config_to_overrides(cfg)
        else:
            raise HTTPException(400, "The LLM configuration assigned to this workspace no longer exists. Please update it in workspace settings.")
    if llm_overrides is None:
        # "Default (env/config)": use env vars (get_settings) so OPENAI_API_KEY + LLM_PROVIDER from .env apply
        # Validate that env actually has usable LLM credentials
        _env = settings
        if _env.llm_provider == "openai" and not (_env.openai_api_key or "").strip():
            raise HTTPException(
                400,
                "No LLM configured. Add an LLM configuration in Account > LLM / AI settings, or set OPENAI_API_KEY in the environment.",
            )
        llm_overrides = None

    # Retrieve History
    history = []
    session_id = body.sessionId
    if session_id:
        r_qa = await db.execute(select(QASession).where(QASession.id == session_id))
        qa_session = r_qa.scalar_one_or_none()
        if qa_session and qa_session.conversation_history:
            history = qa_session.conversation_history

    sql_mode = getattr(agent, "sql_mode", False)

    result = await dispatch_question(
        question=body.question,
        agent=agent,
        sources=sources,
        user=user,
        db=db,
        llm_overrides=llm_overrides,
        history=history,
        session_id=body.sessionId,
        channel=channel,
        sql_mode=sql_mode,
    )

    return AskQuestionResponse(
        answer=result["answer"],
        imageUrl=result.get("image_url"),
        sessionId=result["session_id"],
        followUpQuestions=result.get("follow_up_questions", []),
        turnId=result["turn_id"],
        chartInput=result.get("chart_input"),
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

    # Return cached chartSpec if already generated
    if turn.get("chartSpec"):
        return {
            "chartSpec": turn["chartSpec"],
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
    # When llm_config_id is null ("Default (env/config)"): validate env has usable LLM
    if llm_overrides is None:
        _env = get_settings()
        if _env.llm_provider == "openai" and not (_env.openai_api_key or "").strip():
            raise HTTPException(
                400,
                "No LLM configured. Add an LLM configuration in Account > LLM / AI settings, or set OPENAI_API_KEY in the environment.",
            )

    plan = await build_chart_plan(
        question=str(turn.get("question") or qa.question or ""),
        answer=str(turn.get("answer") or qa.answer or ""),
        chart_input=turn.get("chartInput"),
        llm_overrides=llm_overrides,
    )
    if not plan:
        raise HTTPException(400, "Could not derive a reliable chart from this answer")

    updated_turn = {
        **turn,
        "id": turn_id,
        "chartSpec": plan,
    }
    updated_history = [*history[:turn_index], updated_turn, *history[turn_index + 1 :]]
    qa.conversation_history = updated_history
    await db.commit()

    return {
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
