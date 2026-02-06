"""
POST /api/ask-question: routes to the correct script (CSV, Google Sheets, SQL, BigQuery).
Compatible with frontend payload (question, agentId, userId, sessionId).
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Agent, Source, QASession
from app.auth import require_user
from app.models import User
from app.schemas import AskQuestionRequest, AskQuestionResponse
from app.scripts.ask_csv import ask_csv
from app.scripts.ask_google_sheets import ask_google_sheets
from app.scripts.ask_sql import ask_sql
from app.scripts.ask_bigquery import ask_bigquery
from app.config import get_settings

router = APIRouter(prefix="/ask-question", tags=["ask"])


@router.post("", response_model=AskQuestionResponse)
async def ask_question(
    body: AskQuestionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
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

    source = sources[0]
    settings = get_settings()
    data_files_dir = settings.data_files_dir

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
            columns=meta.get("columns"),
            preview_rows=meta.get("preview_rows"),
            data_files_dir=data_files_dir,
        )
    elif source.type == "google_sheets":
        meta = source.metadata_ or {}
        result = await ask_google_sheets(
            spreadsheet_id=meta.get("spreadsheetId", ""),
            sheet_name=meta.get("sheetName", "Sheet1"),
            question=body.question,
            agent_description=agent.description or "",
        )
    elif source.type == "sql_database":
        meta = source.metadata_ or {}
        result = await ask_sql(
            connection_string=meta.get("connectionString", ""),
            question=body.question,
            agent_description=agent.description or "",
            table_infos=meta.get("table_infos"),
        )
    elif source.type == "bigquery":
        meta = source.metadata_ or {}
        result = await ask_bigquery(
            credentials_content=meta.get("credentialsContent"),
            project_id=meta.get("projectId", ""),
            dataset_id=meta.get("datasetId", ""),
            tables=meta.get("tables", []),
            question=body.question,
            agent_description=agent.description or "",
            table_infos=meta.get("table_infos"),
        )
    else:
        raise HTTPException(400, f"Unsupported source type: {source.type}")

    # Create or update QA session in SQLite
    session_id = body.sessionId
    if session_id:
        r = await db.execute(select(QASession).where(QASession.id == session_id))
        qa = r.scalar_one_or_none()
        if qa:
            history = qa.conversation_history or []
            history.append({
                "question": body.question,
                "answer": result["answer"],
                "imageUrl": result.get("imageUrl"),
                "followUpQuestions": result.get("followUpQuestions", []),
                "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
            })
            qa.conversation_history = history
            qa.follow_up_questions = result.get("followUpQuestions", [])
            await db.flush()
            session_id = str(qa.id)
    else:
        qa = QASession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            agent_id=body.agentId,
            source_id=source.id,
            question=body.question,
            answer=result["answer"],
            table_data={"image_url": result.get("imageUrl")} if result.get("imageUrl") else None,
            follow_up_questions=result.get("followUpQuestions", []),
            conversation_history=[{
                "question": body.question,
                "answer": result["answer"],
                "imageUrl": result.get("imageUrl"),
                "followUpQuestions": result.get("followUpQuestions", []),
                "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
            }],
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
    )
