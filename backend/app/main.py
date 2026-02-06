"""
Data Talks API - Backend without Supabase/Langflow.
JWT auth, SQLite, Python scripts + LLM (OpenAI or Ollama) per source type.
Serves the frontend SPA at / when dist/ exists (after npm run build).
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from sqlalchemy import select
from app.config import get_settings
from app.database import engine, Base, AsyncSessionLocal
from app.routers import auth_router, ask, crud
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Path(get_settings().data_files_dir).mkdir(parents=True, exist_ok=True)
    await _ensure_single_user()
    yield


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

prefix = get_settings().api_prefix
app.include_router(auth_router.router, prefix=prefix)
app.include_router(ask.router, prefix=prefix)
app.include_router(crud.router, prefix=prefix)


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
            from fastapi.responses import JSONResponse
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
