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
from app.routers import auth_router, ask, crud, users_router, settings_router, bigquery_router, firebase_router, sql_router, summary_router, logs_router, audio_overview_router, telegram_router
from app.routers import api_keys_router, public_api_router, whatsapp_router, audit_router, webhook_router, automl_router, report_router
from app.routers import dbt_router, github_router, slack_router, mongodb_router, snowflake_router
from app.models import User
from app.auth import hash_password, GUEST_USER_ID, ADMIN_USER_ID

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_FRONTEND_DIST = _BACKEND_DIR.parent / "dist"
_SERVE_FRONTEND = _FRONTEND_DIST.exists() and (_FRONTEND_DIST / "index.html").exists()


async def _ensure_single_user():
    """Create guest user (login off) or admin user (login on) if missing."""
    settings = get_settings()
    async with AsyncSessionLocal() as db:
        if settings.enable_login:
            if not settings.admin_username or not settings.admin_password:
                return
            r = await db.execute(select(User).where(User.id == ADMIN_USER_ID))
            if r.scalar_one_or_none():
                return
            admin = User(
                id=ADMIN_USER_ID,
                email=settings.admin_username + "@admin.local",
                hashed_password=hash_password(settings.admin_password),
                organization_id=ADMIN_USER_ID,
                role="admin",
            )
            db.add(admin)
        else:
            r = await db.execute(select(User).where(User.id == GUEST_USER_ID))
            if r.scalar_one_or_none():
                return
            # Use a placeholder password (guest never logs in; bcrypt rejects empty string on some platforms)
            guest = User(
                id=GUEST_USER_ID,
                email="guest@local",
                hashed_password=hash_password("guest-no-login"),
                organization_id=GUEST_USER_ID,
                role="user",
            )
            db.add(guest)
        await db.commit()


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
    Path(get_settings().data_files_dir).mkdir(parents=True, exist_ok=True)
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
