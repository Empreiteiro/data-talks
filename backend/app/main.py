"""
Data Talks API - Backend without Supabase/Langflow.
JWT auth, SQLite, Python scripts + LLM (OpenAI or Ollama) per source type.
Serves the frontend SPA at / when dist/ exists (after npm run build).
"""
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from openai import APIConnectionError

from sqlalchemy import inspect, select, text
from app.config import get_settings
from app.database import engine, Base, AsyncSessionLocal
from app.routers import auth_router, ask, crud, users_router, settings_router, bigquery_router, firebase_router, sql_router, summary_router, logs_router, audio_overview_router, telegram_router, onboarding_router
from app.routers import api_keys_router, public_api_router, whatsapp_router, audit_router, webhook_router, automl_router, report_router
from app.routers import dbt_router, github_router, slack_router, mongodb_router, snowflake_router, notion_router, excel_online_router, s3_router, rest_api_router, jira_router, stripe_router, pipedrive_router
from app.routers import template_router
from app.routers import hubspot_router
from app.routers import medallion_router
from app.routers import cdp_router
from app.routers import etl_router
from app.routers import usage_router
from app.routers import data_engineering_router
from app.routers import salesforce_router
from app.routers import ga4_router
from app.routers import intercom_router
from app.routers import github_analytics_router
from app.routers import shopify_router
from app.routers import pipeline_runs_router
from app.routers import pipeline_versions_router
from app.routers import github_integration_router
from app.routers import organizations_router
from app.models import User
from app.auth import hash_password, GUEST_USER_ID, ADMIN_USER_ID

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_FRONTEND_DIST = _BACKEND_DIR.parent / "dist"
_SERVE_FRONTEND = _FRONTEND_DIST.exists() and (_FRONTEND_DIST / "index.html").exists()


async def _ensure_single_user():
    """Create guest user (login off) or admin user (login on) if missing,
    and make sure they have an Organization + owner membership so tenant
    scope resolution works.

    The multi-tenant migration backfilled existing users, but fresh
    installs create users here AFTER migrations run — so this function
    is responsible for mirroring that setup on first boot. It is fully
    idempotent: repeated calls add nothing when the rows already exist.
    """
    from app.models import Organization, OrganizationMembership

    settings = get_settings()
    async with AsyncSessionLocal() as db:
        if settings.enable_login:
            if not settings.admin_username or not settings.admin_password:
                return
            r = await db.execute(select(User).where(User.id == ADMIN_USER_ID))
            admin = r.scalar_one_or_none()
            if not admin:
                admin = User(
                    id=ADMIN_USER_ID,
                    email=settings.admin_username + "@admin.local",
                    hashed_password=hash_password(settings.admin_password),
                    organization_id=None,
                    role="admin",
                )
                db.add(admin)
                await db.flush()
            await _ensure_personal_org_for(db, admin, name="Admin workspace", slug="admin-workspace")
        else:
            r = await db.execute(select(User).where(User.id == GUEST_USER_ID))
            guest = r.scalar_one_or_none()
            if not guest:
                guest = User(
                    id=GUEST_USER_ID,
                    email="guest@local",
                    hashed_password=hash_password("guest-no-login"),
                    organization_id=None,
                    role="user",
                )
                db.add(guest)
                await db.flush()
            await _ensure_personal_org_for(db, guest, name="Guest workspace", slug="guest-workspace")
        await db.commit()


async def _ensure_personal_org_for(
    db,
    user,
    *,
    name: str,
    slug: str,
) -> None:
    """Idempotently give `user` an Organization with an `owner` membership.

    If the user already has at least one membership we just make sure
    their `organization_id` hint points at the earliest one. Otherwise
    we create the Org (with a unique slug) and an owner membership row.
    """
    import uuid as _uuid
    from app.models import Organization, OrganizationMembership

    r = await db.execute(
        select(OrganizationMembership)
        .where(OrganizationMembership.user_id == user.id)
        .order_by(OrganizationMembership.created_at.asc())
        .limit(1)
    )
    existing = r.scalar_one_or_none()
    if existing:
        if not user.organization_id:
            user.organization_id = existing.organization_id
        return

    # Pick a unique slug (append a suffix if taken).
    candidate = slug
    suffix = 2
    while True:
        r = await db.execute(select(Organization.id).where(Organization.slug == candidate))
        if not r.scalar_one_or_none():
            break
        candidate = f"{slug}-{suffix}"
        suffix += 1

    org = Organization(
        id=str(_uuid.uuid4()),
        name=name,
        slug=candidate,
        created_by=user.id,
    )
    db.add(org)
    await db.flush()

    membership = OrganizationMembership(
        id=str(_uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        role="owner",
    )
    db.add(membership)
    if not user.organization_id:
        user.organization_id = org.id
    await db.flush()


async def _ensure_platform_logs_channel_column():
    async with engine.begin() as conn:
        has_channel = await conn.run_sync(
            lambda sync_conn: "channel" in {c["name"] for c in inspect(sync_conn).get_columns("platform_logs")}
        )
        if not has_channel:
            await conn.execute(text("ALTER TABLE platform_logs ADD COLUMN channel VARCHAR(50)"))


async def _ensure_llm_openai_base_url_columns():
    async with engine.begin() as conn:
        table_columns = await conn.run_sync(
            lambda sync_conn: {
                table: {c["name"] for c in inspect(sync_conn).get_columns(table)}
                for table in ("llm_settings", "llm_configs")
                if inspect(sync_conn).has_table(table)
            }
        )
        if "llm_settings" in table_columns and "openai_base_url" not in table_columns["llm_settings"]:
            await conn.execute(text("ALTER TABLE llm_settings ADD COLUMN openai_base_url VARCHAR(512)"))
        if "llm_configs" in table_columns and "openai_base_url" not in table_columns["llm_configs"]:
            await conn.execute(text("ALTER TABLE llm_configs ADD COLUMN openai_base_url VARCHAR(512)"))


async def _ensure_telegram_config_columns():
    async with engine.begin() as conn:
        table_columns = await conn.run_sync(
            lambda sync_conn: {
                table: {c["name"] for c in inspect(sync_conn).get_columns(table)}
                for table in ("telegram_link_tokens", "telegram_connections")
                if inspect(sync_conn).has_table(table)
            }
        )
        for table in ("telegram_link_tokens", "telegram_connections"):
            if table not in table_columns:
                continue
            columns = table_columns[table]
            if "bot_key" not in columns:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN bot_key VARCHAR(64)"))
            if "bot_username" not in columns:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN bot_username VARCHAR(255)"))
            if "telegram_bot_config_id" not in columns:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN telegram_bot_config_id VARCHAR(36)"))


async def _ensure_agent_source_relationships_column():
    async with engine.begin() as conn:
        table_columns = await conn.run_sync(
            lambda sync_conn: {
                table: {c["name"] for c in inspect(sync_conn).get_columns(table)}
                for table in ("agents",)
                if inspect(sync_conn).has_table(table)
            }
        )
        if "agents" in table_columns and "source_relationships" not in table_columns["agents"]:
            await conn.execute(text("ALTER TABLE agents ADD COLUMN source_relationships JSON"))
        if "agents" in table_columns and "dismissed_relationship_suggestions" not in table_columns["agents"]:
            await conn.execute(text("ALTER TABLE agents ADD COLUMN dismissed_relationship_suggestions JSON"))
        if "agents" in table_columns and "sql_mode" not in table_columns["agents"]:
            await conn.execute(text("ALTER TABLE agents ADD COLUMN sql_mode BOOLEAN DEFAULT 0"))


async def _ensure_alert_system_columns():
    async with engine.begin() as conn:
        table_columns = await conn.run_sync(
            lambda sync_conn: {
                table: {c["name"] for c in inspect(sync_conn).get_columns(table)}
                for table in ("alerts",)
                if inspect(sync_conn).has_table(table)
            }
        )
        if "alerts" in table_columns:
            cols = table_columns["alerts"]
            if "type" not in cols:
                await conn.execute(text("ALTER TABLE alerts ADD COLUMN type VARCHAR(50) DEFAULT 'alert'"))
            if "is_active" not in cols:
                await conn.execute(text("ALTER TABLE alerts ADD COLUMN is_active BOOLEAN DEFAULT 1"))
            if "last_run" not in cols:
                await conn.execute(text("ALTER TABLE alerts ADD COLUMN last_run DATETIME"))
            if "last_status" not in cols:
                await conn.execute(text("ALTER TABLE alerts ADD COLUMN last_status VARCHAR(50)"))


async def _ensure_claude_code_columns():
    async with engine.begin() as conn:
        table_columns = await conn.run_sync(
            lambda sync_conn: {
                table: {c["name"] for c in inspect(sync_conn).get_columns(table)}
                for table in ("llm_settings", "llm_configs")
                if inspect(sync_conn).has_table(table)
            }
        )
        for table in ("llm_settings", "llm_configs"):
            if table not in table_columns:
                continue
            cols = table_columns[table]
            if "claude_code_model" not in cols:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN claude_code_model VARCHAR(64)"))
            if "claude_code_oauth_token" not in cols:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN claude_code_oauth_token VARCHAR(512)"))


async def _ensure_workspace_type_columns():
    async with engine.begin() as conn:
        has_table = await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("agents"))
        if has_table:
            cols = await conn.run_sync(lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("agents")})
            if "workspace_type" not in cols:
                await conn.execute(text("ALTER TABLE agents ADD COLUMN workspace_type VARCHAR(30) DEFAULT 'analysis'"))
            if "workspace_config" not in cols:
                await conn.execute(text("ALTER TABLE agents ADD COLUMN workspace_config JSON DEFAULT '{}'"))


async def _ensure_template_agent_id_column():
    async with engine.begin() as conn:
        has_table = await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("report_templates"))
        if has_table:
            cols = await conn.run_sync(lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("report_templates")})
            if "agent_id" not in cols:
                await conn.execute(text("ALTER TABLE report_templates ADD COLUMN agent_id VARCHAR(36)"))


async def _ensure_report_template_id_column():
    async with engine.begin() as conn:
        has_table = await conn.run_sync(lambda sync_conn: inspect(sync_conn).has_table("reports"))
        if has_table:
            cols = await conn.run_sync(lambda sync_conn: {c["name"] for c in inspect(sync_conn).get_columns("reports")})
            if "template_id" not in cols:
                await conn.execute(text("ALTER TABLE reports ADD COLUMN template_id VARCHAR(36)"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _ensure_platform_logs_channel_column()
    await _ensure_llm_openai_base_url_columns()
    await _ensure_telegram_config_columns()
    await _ensure_agent_source_relationships_column()
    await _ensure_alert_system_columns()
    await _ensure_claude_code_columns()
    await _ensure_workspace_type_columns()
    await _ensure_template_agent_id_column()
    await _ensure_report_template_id_column()
    # Initialize storage (local filesystem or S3-backed; see app.services.storage).
    from app.services.storage import get_storage
    get_storage().ensure_ready()
    await _ensure_single_user()
    settings = get_settings()
    import logging
    logging.getLogger("uvicorn.error").info(f"ENABLE_LOGIN={settings.enable_login}")
    
    # Start background workers
    import asyncio
    from app.telegram_bot import polling_worker
    from app.services.alert_scheduler import alert_scheduler_worker
    bg_telegram = asyncio.create_task(polling_worker())
    bg_alerts = asyncio.create_task(alert_scheduler_worker())

    yield

    bg_telegram.cancel()
    bg_alerts.cancel()


app = FastAPI(
    title=get_settings().api_title,
    lifespan=lifespan,
)
# CORS: `allow_origins=["*"]` is incompatible with `allow_credentials=True`
# per the CORS spec (browsers ignore the response when both are set), so we
# build a concrete allowlist that covers:
#   1. The deployment's public URL from `APP_URL` (production behind a domain).
#   2. Any localhost port — covers Vite on 5173, the legacy 8080, the backend
#      itself on 8000/8001, and the static FastAPI server when `dist/` is
#      present. `127.0.0.1` is included on the same regex.
#
# The regex is intentionally narrow: localhost / 127.0.0.1 / 0.0.0.0 only,
# any port, http or https. External origins must be added explicitly to
# `APP_URL` (or extended here once we have a tenant-aware allowlist).
_app_url = (get_settings().app_url or "").strip().rstrip("/")
_explicit_origins = [_app_url] if _app_url else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=_explicit_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.audit_middleware import AuditMiddleware
app.add_middleware(AuditMiddleware)

prefix = get_settings().api_prefix


@app.exception_handler(APIConnectionError)
async def llm_connection_error_handler(_request: Request, exc: APIConnectionError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Não foi possível conectar ao modelo de linguagem. Verifique se o Ollama está rodando (ollama serve) ou configure OpenAI/LiteLLM em Account > LLM."
        },
    )


@app.exception_handler(httpx.ConnectError)
async def httpx_connect_error_handler(_request: Request, exc: httpx.ConnectError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Não foi possível conectar ao modelo de linguagem. Verifique se o serviço (Ollama/OpenAI/LiteLLM) está rodando e acessível."
        },
    )


app.include_router(auth_router.router, prefix=prefix)
app.include_router(ask.router, prefix=prefix)
app.include_router(crud.router, prefix=prefix)
app.include_router(users_router.router, prefix=prefix)
app.include_router(settings_router.router, prefix=prefix)
app.include_router(bigquery_router.router, prefix=prefix)
app.include_router(firebase_router.router, prefix=prefix)
app.include_router(sql_router.router, prefix=prefix)
app.include_router(summary_router.router, prefix=prefix)
app.include_router(onboarding_router.router, prefix=prefix)
app.include_router(logs_router.router, prefix=prefix)
app.include_router(audio_overview_router.router, prefix=prefix)
app.include_router(telegram_router.router, prefix=prefix)
app.include_router(whatsapp_router.router, prefix=prefix)
app.include_router(api_keys_router.router, prefix=prefix)
app.include_router(audit_router.router, prefix=prefix)
app.include_router(webhook_router.router, prefix=prefix)
app.include_router(automl_router.router, prefix=prefix)
app.include_router(report_router.router, prefix=prefix)
app.include_router(public_api_router.router)  # public API at /v1/ask (no internal prefix)
app.include_router(dbt_router.router, prefix=prefix)
app.include_router(github_router.router, prefix=prefix)
app.include_router(slack_router.router, prefix=prefix)
app.include_router(mongodb_router.router, prefix=prefix)
app.include_router(snowflake_router.router, prefix=prefix)
app.include_router(notion_router.router, prefix=prefix)
app.include_router(excel_online_router.router, prefix=prefix)
app.include_router(s3_router.router, prefix=prefix)
app.include_router(rest_api_router.router, prefix=prefix)
app.include_router(jira_router.router, prefix=prefix)
app.include_router(stripe_router.router, prefix=prefix)
app.include_router(template_router.router, prefix=prefix)
app.include_router(hubspot_router.router, prefix=prefix)
app.include_router(salesforce_router.router, prefix=prefix)
app.include_router(ga4_router.router, prefix=prefix)
app.include_router(intercom_router.router, prefix=prefix)
app.include_router(github_analytics_router.router, prefix=prefix)
app.include_router(shopify_router.router, prefix=prefix)
app.include_router(pipedrive_router.router, prefix=prefix)
app.include_router(medallion_router.router, prefix=prefix)
app.include_router(cdp_router.router, prefix=prefix)
app.include_router(etl_router.router, prefix=prefix)
app.include_router(usage_router.router, prefix=prefix)
app.include_router(data_engineering_router.router, prefix=prefix)
app.include_router(pipeline_runs_router.router, prefix=prefix)
app.include_router(pipeline_versions_router.router, prefix=prefix)
app.include_router(github_integration_router.router, prefix=prefix)
app.include_router(organizations_router.router, prefix=prefix)


@app.get(prefix + "/config")
def app_config():
    """Public config for frontend: whether login is required."""
    return {"loginRequired": get_settings().enable_login}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Avoid 404 when the browser requests favicon for the API tab."""
    return Response(status_code=204)


# Mount MCP server (SSE transport) at /mcp when enabled
if get_settings().mcp_enabled:
    try:
        from app.mcp_server import mcp as mcp_server
        app.mount("/mcp", mcp_server.sse_app(mount_path="/mcp"))
    except ImportError:
        import logging
        logging.getLogger("uvicorn.error").warning(
            "MCP dependencies not installed. Install with: uv pip install 'mcp[cli]>=1.8.0'"
        )

if _SERVE_FRONTEND:
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")

    @app.exception_handler(404)
    async def spa_fallback(request: Request, _exc):
        """Serve index.html for non-API routes so SPA client-side routing works."""
        if request.url.path.startswith(prefix):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return FileResponse(_FRONTEND_DIST / "index.html")
else:
    @app.get("/")
    def root():
        """Root when frontend is not built; build with npm run build and restart to serve the app at /."""
        return {
            "message": "Data Talks API",
            "docs": "/docs",
            "health": "/health",
            "api": prefix,
            "app": "Run 'npm run build' in project root, then restart backend to serve the app at http://localhost:8000",
        }
