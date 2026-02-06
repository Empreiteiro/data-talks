"""
Data Talks API - Backend without Supabase/Langflow.
JWT auth, SQLite, Python scripts + LLM (OpenAI or Ollama) per source type.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.routers import auth_router, ask, crud


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Path(get_settings().data_files_dir).mkdir(parents=True, exist_ok=True)
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


@app.get("/health")
def health():
    return {"status": "ok"}
