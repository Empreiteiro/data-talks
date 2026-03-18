"""
MCP (Model Context Protocol) server for Data Talks.
Exposes data analysis tools via SSE transport, mounted on the FastAPI app at /mcp.
"""
from __future__ import annotations

from datetime import datetime

from mcp.server.fastmcp import FastMCP
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.auth import _hash_api_key, GUEST_USER_ID
from app.config import get_settings
from app.models import User, Agent, Source, QASession, LlmConfig, ApiKey

mcp = FastMCP(
    "Data Talks",
    instructions=(
        "Data Talks is an AI-powered data analysis platform. "
        "Use these tools to ask natural language questions about connected data sources, "
        "list available agents and sources, and browse conversation history."
    ),
)


async def _resolve_user(
    db: AsyncSession, api_key: str | None = None
) -> tuple[User, str | None]:
    """Resolve user from API key or guest mode.

    Returns (user, agent_id_from_key).
    Raises ValueError if authentication fails.
    """
    settings = get_settings()

    if api_key:
        key_hash = _hash_api_key(api_key)
        r = await db.execute(
            select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)  # noqa: E712
        )
        api_key_row = r.scalar_one_or_none()
        if not api_key_row:
            raise ValueError("Invalid or inactive API key")
        r = await db.execute(select(User).where(User.id == api_key_row.user_id))
        user = r.scalar_one_or_none()
        if not user:
            raise ValueError("API key owner not found")
        api_key_row.last_used_at = datetime.utcnow()
        await db.flush()
        return user, api_key_row.agent_id

    if not settings.enable_login:
        r = await db.execute(select(User).where(User.id == GUEST_USER_ID))
        user = r.scalar_one_or_none()
        if user:
            return user, None

    raise ValueError(
        "Authentication required. Provide the api_key parameter with a valid Data Talks API key."
    )


async def _resolve_llm_overrides(
    db: AsyncSession, agent: Agent, user: User
) -> dict | None:
    """Resolve LLM overrides from agent config, matching the router logic."""
    from app.routers.ask import _llm_config_to_overrides

    if agent.llm_config_id:
        r = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == agent.llm_config_id, LlmConfig.user_id == user.id
            )
        )
        cfg = r.scalar_one_or_none()
        if cfg:
            return _llm_config_to_overrides(cfg)
    return None


@mcp.tool()
async def ask_question(
    question: str,
    agent_id: str,
    source_ids: list[str] | None = None,
    session_id: str | None = None,
    api_key: str | None = None,
) -> str:
    """Ask a natural language question about your data.

    Analyzes connected data sources using AI and returns an answer.
    Supports conversation continuity via session_id.

    Args:
        question: The question to ask about your data.
        agent_id: ID of the agent (workspace) to query.
        source_ids: Optional list of specific source IDs to query. If omitted, uses all agent sources.
        session_id: Optional session ID to continue a previous conversation.
        api_key: API key for authentication. Not required in guest mode.
    """
    from app.routers.ask import dispatch_question

    async with AsyncSessionLocal() as db:
        try:
            user, default_agent_id = await _resolve_user(db, api_key)
        except ValueError as e:
            return f"Authentication error: {e}"

        # Load agent
        r = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = r.scalar_one_or_none()
        if not agent:
            return f"Agent not found: {agent_id}"

        # Load sources
        if agent.source_ids:
            r = await db.execute(select(Source).where(Source.id.in_(agent.source_ids)))
            all_sources = list(r.scalars().all())
        else:
            r = await db.execute(select(Source).where(Source.agent_id == agent_id))
            all_sources = list(r.scalars().all())

        if not all_sources:
            return "No sources found for this agent."

        # Filter by source_ids if provided
        if source_ids:
            sources = [s for s in all_sources if s.id in set(source_ids)]
            if not sources:
                return "No matching sources for the given source_ids."
        else:
            sources = all_sources

        # Resolve LLM config
        llm_overrides = await _resolve_llm_overrides(db, agent, user)

        # Load conversation history
        history: list[dict] = []
        if session_id:
            r = await db.execute(select(QASession).where(QASession.id == session_id))
            qa = r.scalar_one_or_none()
            if qa and qa.conversation_history:
                history = qa.conversation_history

        sql_mode = getattr(agent, "sql_mode", False)

        try:
            result = await dispatch_question(
                question=question,
                agent=agent,
                sources=sources,
                user=user,
                db=db,
                llm_overrides=llm_overrides,
                history=history,
                session_id=session_id,
                channel="mcp",
                sql_mode=sql_mode,
            )
        except Exception as e:
            return f"Error processing question: {e}"

        parts = [result["answer"]]
        if result.get("follow_up_questions"):
            parts.append("\n\nSuggested follow-up questions:")
            for q in result["follow_up_questions"]:
                parts.append(f"  - {q}")
        parts.append(f"\n\n[session_id: {result['session_id']}]")

        return "\n".join(parts)


@mcp.tool()
async def list_agents(api_key: str | None = None) -> str:
    """List all available agents (workspaces) with their data sources.

    Args:
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            user, _ = await _resolve_user(db, api_key)
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(Agent).where(Agent.user_id == user.id).order_by(Agent.created_at.desc())
        )
        agents = list(r.scalars().all())

        if not agents:
            return "No agents found."

        lines = [f"Found {len(agents)} agent(s):\n"]
        for ag in agents:
            source_count = len(ag.source_ids) if ag.source_ids else 0
            lines.append(f"- **{ag.name}** (id: {ag.id})")
            if ag.description:
                lines.append(f"  Description: {ag.description}")
            lines.append(f"  Sources: {source_count}")
        return "\n".join(lines)


@mcp.tool()
async def list_sources(
    agent_id: str | None = None, api_key: str | None = None
) -> str:
    """List available data sources, optionally filtered by agent.

    Args:
        agent_id: Optional agent ID to filter sources by.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            user, _ = await _resolve_user(db, api_key)
        except ValueError as e:
            return f"Authentication error: {e}"

        if agent_id:
            # Load sources for a specific agent
            r = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = r.scalar_one_or_none()
            if not agent:
                return f"Agent not found: {agent_id}"
            if agent.source_ids:
                r = await db.execute(select(Source).where(Source.id.in_(agent.source_ids)))
            else:
                r = await db.execute(select(Source).where(Source.agent_id == agent_id))
            sources = list(r.scalars().all())
        else:
            r = await db.execute(
                select(Source).where(Source.user_id == user.id).order_by(Source.created_at.desc())
            )
            sources = list(r.scalars().all())

        if not sources:
            return "No sources found."

        lines = [f"Found {len(sources)} source(s):\n"]
        for src in sources:
            status = "active" if src.is_active else "inactive"
            lines.append(f"- **{src.name}** (id: {src.id})")
            lines.append(f"  Type: {src.type} | Status: {status}")
        return "\n".join(lines)


@mcp.tool()
async def list_sessions(
    agent_id: str | None = None,
    limit: int = 20,
    api_key: str | None = None,
) -> str:
    """List recent Q&A conversation sessions.

    Args:
        agent_id: Optional agent ID to filter sessions by.
        limit: Maximum number of sessions to return (default 20).
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            user, _ = await _resolve_user(db, api_key)
        except ValueError as e:
            return f"Authentication error: {e}"

        query = select(QASession).where(
            QASession.user_id == user.id,
            QASession.deleted_at == None,  # noqa: E711
        )
        if agent_id:
            query = query.where(QASession.agent_id == agent_id)
        query = query.order_by(QASession.created_at.desc()).limit(limit)

        r = await db.execute(query)
        sessions = list(r.scalars().all())

        if not sessions:
            return "No sessions found."

        lines = [f"Found {len(sessions)} session(s):\n"]
        for s in sessions:
            answer_preview = (s.answer or "")[:120]
            if len(s.answer or "") > 120:
                answer_preview += "..."
            lines.append(f"- **{s.question}** (id: {s.id})")
            lines.append(f"  Answer: {answer_preview}")
            lines.append(f"  Agent: {s.agent_id} | Created: {s.created_at}")
        return "\n".join(lines)


@mcp.tool()
async def get_session(
    session_id: str, api_key: str | None = None
) -> str:
    """Get full details of a Q&A session including conversation history.

    Args:
        session_id: The session ID to retrieve.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            user, _ = await _resolve_user(db, api_key)
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(QASession).where(
                QASession.id == session_id, QASession.user_id == user.id
            )
        )
        session = r.scalar_one_or_none()
        if not session:
            return f"Session not found: {session_id}"

        lines = [
            f"Session: {session.id}",
            f"Agent: {session.agent_id}",
            f"Created: {session.created_at}",
            "",
        ]

        history = session.conversation_history or []
        if history:
            lines.append(f"Conversation ({len(history)} turn(s)):\n")
            for i, turn in enumerate(history, 1):
                lines.append(f"--- Turn {i} ---")
                lines.append(f"Q: {turn.get('question', '')}")
                lines.append(f"A: {turn.get('answer', '')}")
                follow_ups = turn.get("followUpQuestions", [])
                if follow_ups:
                    lines.append("Follow-ups:")
                    for fq in follow_ups:
                        lines.append(f"  - {fq}")
                lines.append("")
        else:
            lines.append(f"Q: {session.question}")
            lines.append(f"A: {session.answer}")

        if session.follow_up_questions:
            lines.append("Current follow-up suggestions:")
            for fq in session.follow_up_questions:
                lines.append(f"  - {fq}")

        return "\n".join(lines)
