"""
MCP (Model Context Protocol) server for Data Talks.
Exposes data analysis tools via SSE transport, mounted on the FastAPI app at /mcp.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from sqlalchemy import select, update, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from dataclasses import dataclass

from app.database import AsyncSessionLocal
from app.auth import _hash_api_key, GUEST_USER_ID
from app.config import get_settings
from app.models import (
    User,
    Agent,
    Source,
    QASession,
    LlmConfig,
    ApiKey,
    Alert,
    AlertExecution,
    OrganizationMembership,
)

VALID_SOURCE_TYPES = (
    "bigquery",
    "google_sheets",
    "sql_database",
    "firebase",
    "mongodb",
    "snowflake",
    "notion",
    "excel_online",
    "s3",
    "rest_api",
    "jira",
    "hubspot",
    "stripe",
    "pipedrive",
    "salesforce",
    "ga4",
    "intercom",
    "github_analytics",
    "shopify",
)
VALID_WORKSPACE_TYPES = ("analysis", "cdp", "etl")
VALID_LLM_PROVIDERS = (
    "openai",
    "ollama",
    "litellm",
    "google",
    "anthropic",
    "claude-code",
)
VALID_FILE_EXTENSIONS = (
    "csv",
    "xlsx",
    "xls",
    "db",
    "sqlite",
    "sqlite3",
    "parquet",
    "json",
    "jsonl",
)
VALID_ALERT_FREQUENCIES = ("hourly", "daily", "weekly", "monthly")

mcp = FastMCP(
    "Data Talks",
    instructions=(
        "Data Talks is an AI-powered data analysis platform. "
        "Use these tools to ask natural language questions about connected data sources, "
        "list available agents and sources, and browse conversation history."
    ),
)


@dataclass
class _McpScope:
    """Local counterpart of `auth.TenantScope` for the MCP server.

    Holds the authenticated user, the organization they are operating in
    (derived from the API key's `organization_id`, or from the guest user's
    single membership), and the agent_id hint carried by the API key (if any).
    """

    user: User
    organization_id: str
    role: str
    default_agent_id: str | None


async def _resolve_scope(
    db: AsyncSession, api_key: str | None = None
) -> _McpScope:
    """Resolve an MCP caller's tenant scope.

    API key is the normal path: the key is tenant-bound, so we look up the
    caller's membership in the key's organization.

    In guest mode (ENABLE_LOGIN=false) we fall back to the single Guest-org
    membership so local dev keeps working without an API key.

    Raises ValueError if authentication fails. The next commit removes the
    guest fallback entirely.
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

        r = await db.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
                OrganizationMembership.organization_id == api_key_row.organization_id,
            )
        )
        membership = r.scalar_one_or_none()
        if not membership:
            raise ValueError(
                "API key owner has no membership in the key's organization"
            )
        return _McpScope(
            user=user,
            organization_id=api_key_row.organization_id,
            role=membership.role,
            default_agent_id=api_key_row.agent_id,
        )

    if not settings.enable_login:
        r = await db.execute(select(User).where(User.id == GUEST_USER_ID))
        user = r.scalar_one_or_none()
        if user:
            r = await db.execute(
                select(OrganizationMembership)
                .where(OrganizationMembership.user_id == user.id)
                .order_by(OrganizationMembership.created_at.asc())
                .limit(1)
            )
            membership = r.scalar_one_or_none()
            if membership:
                return _McpScope(
                    user=user,
                    organization_id=membership.organization_id,
                    role=membership.role,
                    default_agent_id=None,
                )

    raise ValueError(
        "Authentication required. Provide the api_key parameter with a valid Data Talks API key."
    )


async def _resolve_user(
    db: AsyncSession, api_key: str | None = None
) -> tuple[User, str | None]:
    """Backward-compatible wrapper — existing tools still call this name.
    Prefer `_resolve_scope` for new code so the organization is explicit."""
    scope = await _resolve_scope(db, api_key)
    return scope.user, scope.default_agent_id


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
            scope = await _resolve_scope(db, api_key); user = scope.user
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
            scope = await _resolve_scope(db, api_key); user = scope.user
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
            scope = await _resolve_scope(db, api_key); user = scope.user
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
            scope = await _resolve_scope(db, api_key); user = scope.user
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


# ============================================================================
# Workspace / Agent management
# ============================================================================


async def _load_agent(db: AsyncSession, user: User, agent_id: str) -> Agent | None:
    r = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id)
    )
    return r.scalar_one_or_none()


async def _load_source(db: AsyncSession, user: User, source_id: str) -> Source | None:
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    return r.scalar_one_or_none()


@mcp.tool()
async def create_agent(
    name: str,
    description: str = "",
    workspace_type: str = "analysis",
    source_ids: list[str] | None = None,
    llm_config_id: str | None = None,
    suggested_questions: list[str] | None = None,
    sql_mode: bool = False,
    api_key: str | None = None,
) -> str:
    """Create a new workspace/agent.

    Args:
        name: Display name for the workspace.
        description: Optional description.
        workspace_type: One of "analysis", "cdp", "etl". Defaults to "analysis".
        source_ids: Optional list of existing source IDs to attach.
        llm_config_id: Optional LLM config ID. If omitted, the user's default config is used.
        suggested_questions: Optional list of pre-seeded follow-up questions.
        sql_mode: When True, answers are returned as raw SQL instead of elaborated prose.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        wtype = workspace_type if workspace_type in VALID_WORKSPACE_TYPES else "analysis"

        resolved_llm_id = llm_config_id
        if not resolved_llm_id:
            r = await db.execute(
                select(LlmConfig.id).where(
                    LlmConfig.user_id == user.id,
                    LlmConfig.is_default == True,  # noqa: E712
                ).limit(1)
            )
            resolved_llm_id = r.scalar_one_or_none()
        elif resolved_llm_id:
            r = await db.execute(
                select(LlmConfig.id).where(
                    LlmConfig.id == resolved_llm_id, LlmConfig.user_id == user.id
                )
            )
            if not r.scalar_one_or_none():
                return f"LLM config not found: {resolved_llm_id}"

        if source_ids:
            r = await db.execute(
                select(Source.id).where(
                    Source.id.in_(source_ids), Source.user_id == user.id
                )
            )
            found = set(r.scalars().all())
            missing = [sid for sid in source_ids if sid not in found]
            if missing:
                return f"Source(s) not found or not owned by user: {', '.join(missing)}"

        agent_id = str(uuid.uuid4())
        a = Agent(
            id=agent_id,
            user_id=user.id,
            organization_id=scope.organization_id,
            name=name,
            description=description or "",
            workspace_type=wtype,
            source_ids=list(source_ids or []),
            source_relationships=[],
            suggested_questions=list(suggested_questions or []),
            llm_config_id=resolved_llm_id,
            sql_mode=bool(sql_mode),
        )
        db.add(a)
        await db.commit()
        await db.refresh(a)
        return (
            f"Created agent '{a.name}' (id: {a.id}, type: {a.workspace_type}). "
            f"Sources: {len(a.source_ids or [])}. "
            f"LLM config: {a.llm_config_id or 'none'}."
        )


@mcp.tool()
async def update_agent(
    agent_id: str,
    name: str | None = None,
    description: str | None = None,
    source_ids: list[str] | None = None,
    llm_config_id: str | None = None,
    suggested_questions: list[str] | None = None,
    sql_mode: bool | None = None,
    api_key: str | None = None,
) -> str:
    """Update mutable fields of an existing agent.

    Only fields that are explicitly passed are modified. Pass an empty list to clear source_ids.

    Args:
        agent_id: The agent ID to update.
        name: New name.
        description: New description.
        source_ids: Replace the agent's source_ids with this list.
        llm_config_id: New LLM config ID (must belong to the same user).
        suggested_questions: Replace suggested questions.
        sql_mode: Toggle SQL-only answer mode.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        a = await _load_agent(db, user, agent_id)
        if not a:
            return f"Agent not found: {agent_id}"

        changed: list[str] = []
        if name is not None:
            a.name = name
            changed.append("name")
        if description is not None:
            a.description = description
            changed.append("description")
        if source_ids is not None:
            if source_ids:
                r = await db.execute(
                    select(Source.id).where(
                        Source.id.in_(source_ids), Source.user_id == user.id
                    )
                )
                found = set(r.scalars().all())
                missing = [sid for sid in source_ids if sid not in found]
                if missing:
                    return f"Source(s) not found: {', '.join(missing)}"
            a.source_ids = list(source_ids)
            changed.append("source_ids")
        if llm_config_id is not None:
            if llm_config_id:
                r = await db.execute(
                    select(LlmConfig.id).where(
                        LlmConfig.id == llm_config_id, LlmConfig.user_id == user.id
                    )
                )
                if not r.scalar_one_or_none():
                    return f"LLM config not found: {llm_config_id}"
            a.llm_config_id = llm_config_id or None
            changed.append("llm_config_id")
        if suggested_questions is not None:
            a.suggested_questions = list(suggested_questions)
            changed.append("suggested_questions")
        if sql_mode is not None:
            a.sql_mode = bool(sql_mode)
            changed.append("sql_mode")

        if not changed:
            return "No fields provided to update."

        await db.commit()
        return f"Updated agent {a.id}. Fields changed: {', '.join(changed)}."


@mcp.tool()
async def delete_agent(
    agent_id: str,
    confirm: bool = False,
    api_key: str | None = None,
) -> str:
    """Delete an agent. Requires confirm=True to prevent accidental deletion.

    Note: sources attached to this agent are not deleted, only the agent itself.

    Args:
        agent_id: The agent ID to delete.
        confirm: Must be True to actually perform the deletion.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not confirm:
        return (
            "Deletion aborted. Re-run with confirm=True to actually delete this agent. "
            "Sources attached to the agent will NOT be deleted."
        )
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        a = await _load_agent(db, user, agent_id)
        if not a:
            return f"Agent not found: {agent_id}"
        name = a.name
        await db.delete(a)
        await db.commit()
        return f"Deleted agent '{name}' (id: {agent_id})."


@mcp.tool()
async def add_sources_to_agent(
    agent_id: str,
    source_ids: list[str],
    api_key: str | None = None,
) -> str:
    """Add one or more existing sources to an agent (idempotent).

    Args:
        agent_id: Target agent ID.
        source_ids: List of source IDs to attach.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not source_ids:
        return "No source_ids provided."
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        a = await _load_agent(db, user, agent_id)
        if not a:
            return f"Agent not found: {agent_id}"

        r = await db.execute(
            select(Source.id).where(
                Source.id.in_(source_ids), Source.user_id == user.id
            )
        )
        found = set(r.scalars().all())
        missing = [sid for sid in source_ids if sid not in found]
        if missing:
            return f"Source(s) not found: {', '.join(missing)}"

        current = list(a.source_ids or [])
        added: list[str] = []
        for sid in source_ids:
            if sid not in current:
                current.append(sid)
                added.append(sid)
        a.source_ids = current
        await db.commit()
        if not added:
            return f"All {len(source_ids)} source(s) were already attached to agent {agent_id}."
        return f"Added {len(added)} source(s) to agent {agent_id}: {', '.join(added)}."


@mcp.tool()
async def remove_sources_from_agent(
    agent_id: str,
    source_ids: list[str],
    api_key: str | None = None,
) -> str:
    """Remove one or more sources from an agent's source_ids list.

    The sources themselves are not deleted.

    Args:
        agent_id: Target agent ID.
        source_ids: Source IDs to detach.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not source_ids:
        return "No source_ids provided."
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        a = await _load_agent(db, user, agent_id)
        if not a:
            return f"Agent not found: {agent_id}"

        current = list(a.source_ids or [])
        to_remove = set(source_ids)
        new_list = [sid for sid in current if sid not in to_remove]
        removed_count = len(current) - len(new_list)
        a.source_ids = new_list
        await db.commit()
        return f"Removed {removed_count} source(s) from agent {agent_id}. Remaining: {len(new_list)}."


# ============================================================================
# Source management
# ============================================================================


@mcp.tool()
async def create_source(
    name: str,
    type: str,
    metadata: dict | None = None,
    agent_id: str | None = None,
    api_key: str | None = None,
) -> str:
    """Create a new connection-based data source (non-file).

    Supported types: bigquery, google_sheets, sql_database, firebase, mongodb, snowflake,
    notion, excel_online, s3, rest_api, jira, hubspot, stripe, pipedrive, salesforce,
    ga4, intercom, github_analytics, shopify.

    The metadata dict holds type-specific connection info (credentials, host, etc.).
    For file uploads (CSV, XLSX, sqlite, parquet, json, jsonl), use upload_file_source instead.

    Args:
        name: Display name for the source.
        type: One of the supported source types listed above.
        metadata: Type-specific configuration dict (connection strings, credentials, etc.).
        agent_id: Optional agent to attach this source to on creation.
        api_key: API key for authentication. Not required in guest mode.
    """
    if type not in VALID_SOURCE_TYPES:
        return (
            f"Invalid source type '{type}'. Must be one of: {', '.join(VALID_SOURCE_TYPES)}. "
            "For file-based sources use upload_file_source."
        )
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        if agent_id:
            a = await _load_agent(db, user, agent_id)
            if not a:
                return f"Agent not found: {agent_id}"

        source_id = str(uuid.uuid4())
        s = Source(
            id=source_id,
            user_id=user.id,
            organization_id=scope.organization_id,
            agent_id=agent_id,
            name=name,
            type=type,
            metadata_=metadata or {},
        )
        db.add(s)
        await db.commit()
        return (
            f"Created source '{name}' (id: {source_id}, type: {type})."
            + (f" Attached to agent {agent_id}." if agent_id else "")
        )


@mcp.tool()
async def upload_file_source(
    file_path: str,
    name: str | None = None,
    api_key: str | None = None,
) -> str:
    """Register a file-based data source from a local file path on the server.

    The file is copied into the Data Talks data directory and introspected (columns,
    preview rows, row count, sample profile).

    Supported extensions: csv, xlsx, xls, db, sqlite, sqlite3, parquet, json, jsonl.

    Args:
        file_path: Absolute path to a local file on the server filesystem.
        name: Optional display name (defaults to the file's basename).
        api_key: API key for authentication. Not required in guest mode.
    """
    src_path = Path(file_path).expanduser()
    if not src_path.is_absolute():
        return "file_path must be an absolute path on the server filesystem."
    if not src_path.exists() or not src_path.is_file():
        return f"File not found: {src_path}"

    ext = src_path.suffix.lstrip(".").lower()
    if ext not in VALID_FILE_EXTENSIONS:
        return (
            f"Unsupported file extension '.{ext}'. "
            f"Allowed: {', '.join(VALID_FILE_EXTENSIONS)}."
        )

    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        from app.services.storage import get_storage
        storage = get_storage()
        rel_path = f"{user.id}/{uuid.uuid4().hex}.{ext}"
        try:
            storage.write_bytes(rel_path, src_path.read_bytes())
        except (OSError, Exception) as e:  # noqa: BLE001
            return f"Failed to upload file: {e}"
        dest = storage.local_path(rel_path)

        # Introspect using the same logic as the upload router
        from app.routers.crud import _sanitize_for_json, _build_sample_profile

        meta: dict = {
            "file_path": rel_path,
            "columns": [],
            "preview_rows": [],
            "row_count": 0,
            "sample_profile": {},
            "sample_row_count": 0,
        }
        source_type = "csv"

        try:
            if ext in ("db", "sqlite", "sqlite3"):
                from app.scripts.ask_sqlite import _introspect_sqlite_sync

                table_infos = _introspect_sqlite_sync(str(dest))
                meta = {
                    "file_path": rel_path,
                    "tables": [ti["table"] for ti in table_infos],
                    "table_infos": _sanitize_for_json(table_infos),
                }
                source_type = "sqlite"
            elif ext == "csv":
                import pandas as pd

                df = pd.read_csv(dest, nrows=1000)
                meta["columns"] = list(df.columns)
                meta["preview_rows"] = _sanitize_for_json(
                    df.head(5).to_dict(orient="records")
                )
                meta["row_count"] = len(df)
                meta["sample_row_count"] = len(df)
                meta["sample_profile"] = _build_sample_profile(df)
            elif ext == "parquet":
                import pandas as pd

                df = pd.read_parquet(dest).head(1000)
                meta["columns"] = list(df.columns)
                meta["preview_rows"] = _sanitize_for_json(
                    df.head(5).to_dict(orient="records")
                )
                meta["row_count"] = len(df)
                meta["sample_row_count"] = len(df)
                meta["sample_profile"] = _build_sample_profile(df)
                source_type = "parquet"
            elif ext == "jsonl":
                import pandas as pd

                df = pd.read_json(dest, lines=True, nrows=1000)
                meta["columns"] = list(df.columns)
                meta["preview_rows"] = _sanitize_for_json(
                    df.head(5).to_dict(orient="records")
                )
                meta["row_count"] = len(df)
                meta["sample_row_count"] = len(df)
                meta["sample_profile"] = _build_sample_profile(df)
                source_type = "json"
            elif ext == "json":
                import json as json_mod

                import pandas as pd

                raw_data = json_mod.loads(dest.read_text())
                if isinstance(raw_data, list):
                    df = pd.json_normalize(raw_data)
                elif isinstance(raw_data, dict):
                    for key in ("data", "results", "items", "records"):
                        if key in raw_data and isinstance(raw_data[key], list):
                            df = pd.json_normalize(raw_data[key])
                            break
                    else:
                        df = pd.json_normalize([raw_data])
                else:
                    df = pd.DataFrame([{"value": raw_data}])
                df = df.head(1000)
                meta["columns"] = list(df.columns)
                meta["preview_rows"] = _sanitize_for_json(
                    df.head(5).to_dict(orient="records")
                )
                meta["row_count"] = len(df)
                meta["sample_row_count"] = len(df)
                meta["sample_profile"] = _build_sample_profile(df)
                source_type = "json"
            else:
                import pandas as pd

                df = pd.read_excel(dest, nrows=1000)
                meta["columns"] = list(df.columns)
                meta["preview_rows"] = _sanitize_for_json(
                    df.head(5).to_dict(orient="records")
                )
                meta["row_count"] = len(df)
                meta["sample_row_count"] = len(df)
                meta["sample_profile"] = _build_sample_profile(df)
                source_type = "xlsx"
        except Exception as e:
            # Roll back the copied file on introspection failure
            try:
                dest.unlink()
            except OSError:
                pass
            return f"Failed to introspect file: {e}"

        meta = _sanitize_for_json(meta) or meta

        source_id = str(uuid.uuid4())
        s = Source(
            id=source_id,
            user_id=user.id,
            organization_id=scope.organization_id,
            agent_id=None,
            name=name or src_path.name,
            type=source_type,
            metadata_=meta,
        )
        db.add(s)
        await db.commit()
        columns = meta.get("columns") or meta.get("tables") or []
        return (
            f"Uploaded source '{s.name}' (id: {source_id}, type: {source_type}). "
            f"Columns/tables: {columns}."
        )


@mcp.tool()
async def update_source(
    source_id: str,
    agent_id: str | None = None,
    is_active: bool | None = None,
    api_key: str | None = None,
) -> str:
    """Update a source's agent attachment or active state.

    Args:
        source_id: Source ID to update.
        agent_id: Set the source's home agent (pass an empty string to detach).
        is_active: Activate or deactivate the source.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        s = await _load_source(db, user, source_id)
        if not s:
            return f"Source not found: {source_id}"

        changed: list[str] = []
        if agent_id is not None:
            if agent_id:
                a = await _load_agent(db, user, agent_id)
                if not a:
                    return f"Agent not found: {agent_id}"
                s.agent_id = agent_id
            else:
                s.agent_id = None
            changed.append("agent_id")
        if is_active is not None:
            s.is_active = bool(is_active)
            changed.append("is_active")

        if not changed:
            return "No fields provided to update."
        await db.commit()
        return f"Updated source {source_id}. Fields changed: {', '.join(changed)}."


@mcp.tool()
async def delete_source(
    source_id: str,
    confirm: bool = False,
    api_key: str | None = None,
) -> str:
    """Delete a source. If it's a file-based source, the underlying file is also removed.

    Args:
        source_id: Source ID to delete.
        confirm: Must be True to actually perform the deletion.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not confirm:
        return (
            "Deletion aborted. Re-run with confirm=True to actually delete this source. "
            "File-based sources will have their underlying file deleted as well."
        )
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        s = await _load_source(db, user, source_id)
        if not s:
            return f"Source not found: {source_id}"

        name = s.name
        meta = s.metadata_ or {}
        fp = meta.get("file_path")
        if fp:
            from app.services.storage import get_storage
            get_storage().delete(fp)
        await db.delete(s)
        await db.commit()
        return f"Deleted source '{name}' (id: {source_id})."


# ============================================================================
# LLM config management
# ============================================================================


@mcp.tool()
async def list_llm_configs(api_key: str | None = None) -> str:
    """List all LLM configurations for the current user.

    Secrets (API keys, tokens) are never returned — only booleans indicating presence.

    Args:
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(LlmConfig)
            .where(LlmConfig.user_id == user.id)
            .order_by(LlmConfig.created_at.desc())
        )
        configs = list(r.scalars().all())
        if not configs:
            return "No LLM configs found."

        lines = [f"Found {len(configs)} LLM config(s):\n"]
        for c in configs:
            default_tag = " [default]" if getattr(c, "is_default", False) else ""
            lines.append(f"- **{c.name}**{default_tag} (id: {c.id})")
            lines.append(f"  Provider: {c.llm_provider}")
            if c.llm_provider == "openai":
                lines.append(f"  Model: {c.openai_model or '(env default)'}")
                lines.append(f"  Base URL: {c.openai_base_url or '(env default)'}")
            elif c.llm_provider == "ollama":
                lines.append(f"  Model: {c.ollama_model or '(env default)'}")
                lines.append(f"  Base URL: {c.ollama_base_url or '(env default)'}")
            elif c.llm_provider == "litellm":
                lines.append(f"  Model: {c.litellm_model or '(env default)'}")
                lines.append(f"  Base URL: {c.litellm_base_url or '(env default)'}")
            elif c.llm_provider == "google":
                lines.append(f"  Model: {c.google_model or '(env default)'}")
            elif c.llm_provider == "anthropic":
                lines.append(f"  Model: {c.anthropic_model or '(env default)'}")
            elif c.llm_provider == "claude-code":
                lines.append(f"  Model: {c.claude_code_model or '(env default)'}")
        return "\n".join(lines)


@mcp.tool()
async def create_llm_config(
    name: str,
    llm_provider: str,
    openai_api_key: str | None = None,
    openai_base_url: str | None = None,
    openai_model: str | None = None,
    ollama_base_url: str | None = None,
    ollama_model: str | None = None,
    litellm_api_key: str | None = None,
    litellm_base_url: str | None = None,
    litellm_model: str | None = None,
    google_api_key: str | None = None,
    google_model: str | None = None,
    anthropic_api_key: str | None = None,
    anthropic_model: str | None = None,
    claude_code_oauth_token: str | None = None,
    claude_code_model: str | None = None,
    is_default: bool = False,
    api_key: str | None = None,
) -> str:
    """Create a new LLM configuration.

    Provide only the fields relevant to the chosen provider. The first config you create
    is automatically marked as default; set is_default=True here to override.

    Args:
        name: Display name for this LLM config.
        llm_provider: One of "openai", "ollama", "litellm", "google", "anthropic", "claude-code".
        openai_api_key / openai_base_url / openai_model: OpenAI settings.
        ollama_base_url / ollama_model: Ollama settings.
        litellm_api_key / litellm_base_url / litellm_model: LiteLLM settings.
        google_api_key / google_model: Google (Gemini) settings.
        anthropic_api_key / anthropic_model: Anthropic settings.
        claude_code_oauth_token / claude_code_model: Claude Code settings.
        is_default: Mark this config as the user's default.
        api_key: API key for authentication. Not required in guest mode.
    """
    if llm_provider not in VALID_LLM_PROVIDERS:
        return (
            f"Invalid llm_provider '{llm_provider}'. "
            f"Must be one of: {', '.join(VALID_LLM_PROVIDERS)}."
        )

    def _opt(s: str | None) -> str | None:
        return (s or "").strip() or None

    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        config_id = str(uuid.uuid4())
        c = LlmConfig(
            id=config_id,
            user_id=user.id,
            name=name.strip(),
            llm_provider=llm_provider,
            openai_api_key=_opt(openai_api_key),
            openai_base_url=_opt(
                openai_base_url.rstrip("/") if openai_base_url else None
            ),
            openai_model=_opt(openai_model),
            ollama_base_url=_opt(ollama_base_url),
            ollama_model=_opt(ollama_model),
            litellm_base_url=_opt(litellm_base_url),
            litellm_model=_opt(litellm_model),
            litellm_api_key=_opt(litellm_api_key),
            google_api_key=_opt(google_api_key),
            google_model=_opt(google_model),
            anthropic_api_key=_opt(anthropic_api_key),
            anthropic_model=_opt(anthropic_model),
            claude_code_model=_opt(claude_code_model),
            claude_code_oauth_token=_opt(claude_code_oauth_token),
        )
        db.add(c)
        await db.flush()

        if is_default:
            await db.execute(
                update(LlmConfig)
                .where(LlmConfig.user_id == user.id, LlmConfig.id != c.id)
                .values(is_default=False)
            )
            c.is_default = True
        else:
            # Auto-default if this is the user's first config
            r = await db.execute(
                select(LlmConfig).where(LlmConfig.user_id == user.id)
            )
            all_configs = r.scalars().all()
            if len(all_configs) == 1:
                c.is_default = True

        await db.commit()
        default_tag = " [default]" if c.is_default else ""
        return (
            f"Created LLM config '{c.name}'{default_tag} "
            f"(id: {c.id}, provider: {c.llm_provider})."
        )


@mcp.tool()
async def update_llm_config(
    config_id: str,
    name: str | None = None,
    llm_provider: str | None = None,
    openai_api_key: str | None = None,
    openai_base_url: str | None = None,
    openai_model: str | None = None,
    ollama_base_url: str | None = None,
    ollama_model: str | None = None,
    litellm_api_key: str | None = None,
    litellm_base_url: str | None = None,
    litellm_model: str | None = None,
    google_api_key: str | None = None,
    google_model: str | None = None,
    anthropic_api_key: str | None = None,
    anthropic_model: str | None = None,
    claude_code_oauth_token: str | None = None,
    claude_code_model: str | None = None,
    is_default: bool | None = None,
    api_key: str | None = None,
) -> str:
    """Update an existing LLM configuration.

    Only fields you pass are modified. Pass an empty string to clear a credential field.

    Args:
        config_id: LLM config ID to update.
        (see create_llm_config for the meaning of the provider-specific fields)
        is_default: Mark (or unmark) this config as the user's default.
        api_key: API key for authentication. Not required in guest mode.
    """
    if llm_provider is not None and llm_provider not in VALID_LLM_PROVIDERS:
        return (
            f"Invalid llm_provider '{llm_provider}'. "
            f"Must be one of: {', '.join(VALID_LLM_PROVIDERS)}."
        )
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == config_id, LlmConfig.user_id == user.id
            )
        )
        c = r.scalar_one_or_none()
        if not c:
            return f"LLM config not found: {config_id}"

        changed: list[str] = []

        def _set_secret(attr: str, val: str | None) -> None:
            if val is None:
                return
            clean = val.strip()
            setattr(c, attr, clean or None)
            changed.append(attr)

        def _set_plain(attr: str, val: str | None) -> None:
            if val is None:
                return
            clean = val.strip()
            setattr(c, attr, clean or None)
            changed.append(attr)

        if name is not None:
            c.name = name.strip()
            changed.append("name")
        if llm_provider is not None:
            c.llm_provider = llm_provider
            changed.append("llm_provider")
        _set_secret("openai_api_key", openai_api_key)
        if openai_base_url is not None:
            c.openai_base_url = openai_base_url.strip().rstrip("/") or None
            changed.append("openai_base_url")
        _set_plain("openai_model", openai_model)
        _set_plain("ollama_base_url", ollama_base_url)
        _set_plain("ollama_model", ollama_model)
        _set_plain("litellm_base_url", litellm_base_url)
        _set_plain("litellm_model", litellm_model)
        _set_secret("litellm_api_key", litellm_api_key)
        _set_secret("google_api_key", google_api_key)
        _set_plain("google_model", google_model)
        _set_secret("anthropic_api_key", anthropic_api_key)
        _set_plain("anthropic_model", anthropic_model)
        _set_plain("claude_code_model", claude_code_model)
        _set_secret("claude_code_oauth_token", claude_code_oauth_token)

        if is_default is True:
            await db.execute(
                update(LlmConfig)
                .where(LlmConfig.user_id == user.id)
                .values(is_default=False)
            )
            c.is_default = True
            changed.append("is_default")
        elif is_default is False:
            c.is_default = False
            changed.append("is_default")

        if not changed:
            return "No fields provided to update."
        await db.commit()
        return f"Updated LLM config {c.id}. Fields changed: {', '.join(changed)}."


@mcp.tool()
async def set_default_llm_config(
    config_id: str,
    api_key: str | None = None,
) -> str:
    """Mark an LLM config as the user's default (used for newly created workspaces).

    Args:
        config_id: The LLM config ID to mark as default.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == config_id, LlmConfig.user_id == user.id
            )
        )
        c = r.scalar_one_or_none()
        if not c:
            return f"LLM config not found: {config_id}"

        await db.execute(
            update(LlmConfig)
            .where(LlmConfig.user_id == user.id)
            .values(is_default=False)
        )
        c.is_default = True
        await db.commit()
        return f"Set '{c.name}' (id: {c.id}) as the default LLM config."


@mcp.tool()
async def delete_llm_config(
    config_id: str,
    confirm: bool = False,
    api_key: str | None = None,
) -> str:
    """Delete an LLM configuration. Requires confirm=True.

    Args:
        config_id: LLM config ID to delete.
        confirm: Must be True to actually perform the deletion.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not confirm:
        return "Deletion aborted. Re-run with confirm=True to actually delete this LLM config."
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == config_id, LlmConfig.user_id == user.id
            )
        )
        c = r.scalar_one_or_none()
        if not c:
            return f"LLM config not found: {config_id}"

        name = c.name
        await db.delete(c)
        await db.commit()
        return f"Deleted LLM config '{name}' (id: {config_id})."


# ============================================================================
# Alerts & reports
# ============================================================================


@mcp.tool()
async def list_alerts(
    agent_id: str | None = None,
    api_key: str | None = None,
) -> str:
    """List alerts and scheduled reports, optionally filtered by agent.

    Args:
        agent_id: Optional agent ID to filter by.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        q = select(Alert).where(Alert.user_id == user.id)
        if agent_id:
            q = q.where(Alert.agent_id == agent_id)
        q = q.order_by(Alert.created_at.desc())
        r = await db.execute(q)
        alerts = list(r.scalars().all())
        if not alerts:
            return "No alerts found."

        lines = [f"Found {len(alerts)} alert(s):\n"]
        for a in alerts:
            status = "active" if a.is_active else "paused"
            atype = getattr(a, "type", "alert") or "alert"
            lines.append(f"- **{a.name}** [{atype}] (id: {a.id}) — {status}")
            lines.append(f"  Agent: {a.agent_id} | Email: {a.email}")
            lines.append(
                f"  Frequency: {a.frequency} at {a.execution_time}"
                + (f" (day_of_week={a.day_of_week})" if a.day_of_week is not None else "")
                + (f" (day_of_month={a.day_of_month})" if a.day_of_month is not None else "")
            )
            lines.append(f"  Question: {a.question}")
            if a.next_run:
                lines.append(f"  Next run: {a.next_run.isoformat()}")
            if a.last_run:
                lines.append(
                    f"  Last run: {a.last_run.isoformat()} ({a.last_status or 'unknown'})"
                )
        return "\n".join(lines)


@mcp.tool()
async def create_alert(
    agent_id: str,
    name: str,
    question: str,
    email: str,
    frequency: str,
    execution_time: str = "09:00",
    type: str = "alert",
    day_of_week: int | None = None,
    day_of_month: int | None = None,
    api_key: str | None = None,
) -> str:
    """Schedule a recurring question that is run against an agent and delivered by email.

    Args:
        agent_id: Agent to run the question against.
        name: Display name for this alert/report.
        question: The natural-language question to execute.
        email: Destination email address.
        frequency: One of "hourly", "daily", "weekly", "monthly".
        execution_time: Time of day to execute, in "HH:MM" 24h format. Defaults to "09:00".
        type: "alert" (fires on condition) or "report" (always delivered). Defaults to "alert".
        day_of_week: For weekly frequency, 0=Monday ... 6=Sunday.
        day_of_month: For monthly frequency, 1-31.
        api_key: API key for authentication. Not required in guest mode.
    """
    if frequency not in VALID_ALERT_FREQUENCIES:
        return (
            f"Invalid frequency '{frequency}'. "
            f"Must be one of: {', '.join(VALID_ALERT_FREQUENCIES)}."
        )
    if type not in ("alert", "report"):
        return "type must be 'alert' or 'report'."

    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        a_row = await _load_agent(db, user, agent_id)
        if not a_row:
            return f"Agent not found: {agent_id}"

        from app.services.alert_scheduler import _compute_next_run

        alert_id = str(uuid.uuid4())
        alert = Alert(
            id=alert_id,
            user_id=user.id,
            agent_id=agent_id,
            name=name,
            type=type,
            question=question,
            email=email,
            frequency=frequency,
            execution_time=execution_time,
            day_of_week=day_of_week,
            day_of_month=day_of_month,
            is_active=True,
        )
        alert.next_run = _compute_next_run(alert)
        db.add(alert)
        await db.commit()
        await db.refresh(alert)
        next_run = alert.next_run.isoformat() if alert.next_run else "n/a"
        return (
            f"Created {type} '{name}' (id: {alert_id}) for agent {agent_id}. "
            f"Frequency: {frequency} at {execution_time}. Next run: {next_run}."
        )


@mcp.tool()
async def update_alert(
    alert_id: str,
    name: str | None = None,
    question: str | None = None,
    email: str | None = None,
    frequency: str | None = None,
    execution_time: str | None = None,
    day_of_week: int | None = None,
    day_of_month: int | None = None,
    is_active: bool | None = None,
    type: str | None = None,
    api_key: str | None = None,
) -> str:
    """Update an existing alert or report.

    Only fields passed are modified. Changing frequency/execution_time/day_of_* recomputes next_run.

    Args:
        alert_id: Alert ID to update.
        (see create_alert for field meanings)
        is_active: Pause or resume scheduling.
        api_key: API key for authentication. Not required in guest mode.
    """
    if frequency is not None and frequency not in VALID_ALERT_FREQUENCIES:
        return (
            f"Invalid frequency '{frequency}'. "
            f"Must be one of: {', '.join(VALID_ALERT_FREQUENCIES)}."
        )
    if type is not None and type not in ("alert", "report"):
        return "type must be 'alert' or 'report'."

    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id)
        )
        alert = r.scalar_one_or_none()
        if not alert:
            return f"Alert not found: {alert_id}"

        from app.services.alert_scheduler import _compute_next_run

        changed: list[str] = []
        recalc = False
        if name is not None:
            alert.name = name
            changed.append("name")
        if question is not None:
            alert.question = question
            changed.append("question")
        if email is not None:
            alert.email = email
            changed.append("email")
        if type is not None:
            alert.type = type
            changed.append("type")
        if is_active is not None:
            alert.is_active = bool(is_active)
            changed.append("is_active")
        if frequency is not None:
            alert.frequency = frequency
            changed.append("frequency")
            recalc = True
        if execution_time is not None:
            alert.execution_time = execution_time
            changed.append("execution_time")
            recalc = True
        if day_of_week is not None:
            alert.day_of_week = day_of_week
            changed.append("day_of_week")
            recalc = True
        if day_of_month is not None:
            alert.day_of_month = day_of_month
            changed.append("day_of_month")
            recalc = True

        if not changed:
            return "No fields provided to update."

        if recalc:
            alert.next_run = _compute_next_run(alert)

        await db.commit()
        return f"Updated alert {alert_id}. Fields changed: {', '.join(changed)}."


@mcp.tool()
async def delete_alert(
    alert_id: str,
    confirm: bool = False,
    api_key: str | None = None,
) -> str:
    """Delete an alert or report and its execution history. Requires confirm=True.

    Args:
        alert_id: Alert ID to delete.
        confirm: Must be True to actually perform the deletion.
        api_key: API key for authentication. Not required in guest mode.
    """
    if not confirm:
        return "Deletion aborted. Re-run with confirm=True to actually delete this alert."
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id)
        )
        alert = r.scalar_one_or_none()
        if not alert:
            return f"Alert not found: {alert_id}"

        name = alert.name
        await db.execute(
            sql_delete(AlertExecution).where(AlertExecution.alert_id == alert_id)
        )
        await db.delete(alert)
        await db.commit()
        return f"Deleted alert '{name}' (id: {alert_id}) and its execution history."


@mcp.tool()
async def test_alert(
    alert_id: str,
    api_key: str | None = None,
) -> str:
    """Execute an alert or report immediately for testing, bypassing the schedule.

    Args:
        alert_id: Alert ID to run.
        api_key: API key for authentication. Not required in guest mode.
    """
    async with AsyncSessionLocal() as db:
        try:
            scope = await _resolve_scope(db, api_key); user = scope.user
        except ValueError as e:
            return f"Authentication error: {e}"

        r = await db.execute(
            select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id)
        )
        alert = r.scalar_one_or_none()
        if not alert:
            return f"Alert not found: {alert_id}"

    from app.services.alert_scheduler import execute_alert_now

    try:
        result = await execute_alert_now(alert_id)
    except Exception as e:
        return f"Error executing alert: {e}"

    status = result.get("status", "unknown") if isinstance(result, dict) else "unknown"
    answer = ""
    if isinstance(result, dict):
        answer = result.get("answer") or result.get("error_message") or ""
    snippet = answer[:400] + ("..." if len(answer) > 400 else "")
    return f"Alert {alert_id} executed with status: {status}\n{snippet}"
