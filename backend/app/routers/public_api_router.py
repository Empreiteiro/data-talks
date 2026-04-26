"""
Public API: POST /api/v1/ask
Authenticates via X-API-Key header.
Routes to the same ask scripts as the internal ask.py router via dispatch_question().
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import get_api_key_user
from app.models import User, Agent, Source, QASession, LlmConfig, ApiKey
from app.schemas import PublicAskRequest, AskQuestionResponse
from app.config import get_settings
from app.routers.ask import _llm_config_to_overrides, dispatch_question

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

    # LLM overrides — agent-attached config, with fallback to the
    # user's default LlmConfig when the workspace has none.
    from app.routers.ask import resolve_agent_llm_overrides
    llm_overrides = await resolve_agent_llm_overrides(db, agent, user.id)

    # Retrieve history
    history: list[dict] = []
    session_id = body.session_id
    if session_id:
        r_qa = await db.execute(select(QASession).where(QASession.id == session_id))
        qa_session = r_qa.scalar_one_or_none()
        if qa_session and qa_session.conversation_history:
            history = qa_session.conversation_history

    result = await dispatch_question(
        question=body.question,
        agent=agent,
        sources=sources,
        user=user,
        db=db,
        llm_overrides=llm_overrides,
        history=history,
        session_id=session_id,
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
