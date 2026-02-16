"""LLM and app settings API."""
import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, LlmSettings
from app.auth import require_user
from app.config import get_settings

router = APIRouter(prefix="/settings", tags=["settings"])


class LlmSettingsResponse(BaseModel):
    llm_provider: str
    openai_api_key: Optional[str] = None  # Masked in response; empty if not set
    openai_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_api_key: Optional[str] = None  # Masked


class LlmSettingsUpdate(BaseModel):
    llm_provider: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_api_key: Optional[str] = None


def _mask_api_key(key: str | None) -> str:
    """Return masked value for display (e.g. sk-...xyz) or empty if not set."""
    if not key or not key.strip():
        return ""
    k = key.strip()
    if len(k) <= 8:
        return "••••"
    return k[:4] + "••••" + k[-4:]


@router.get("/llm", response_model=LlmSettingsResponse)
async def get_llm_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Get current user's LLM settings. Uses env defaults when not overridden."""
    env = get_settings()
    r = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    row = r.scalar_one_or_none()
    if row:
        return LlmSettingsResponse(
            llm_provider=row.llm_provider or env.llm_provider,
            openai_api_key=_mask_api_key(row.openai_api_key) if row.openai_api_key else _mask_api_key(env.openai_api_key),
            openai_model=row.openai_model or env.openai_model,
            ollama_base_url=row.ollama_base_url or env.ollama_base_url,
            ollama_model=row.ollama_model or env.ollama_model,
            litellm_base_url=row.litellm_base_url or env.litellm_base_url,
            litellm_model=row.litellm_model or env.litellm_model,
            litellm_api_key=_mask_api_key(row.litellm_api_key) if row.litellm_api_key else _mask_api_key(env.litellm_api_key or ""),
        )
    return LlmSettingsResponse(
        llm_provider=env.llm_provider,
        openai_api_key=_mask_api_key(env.openai_api_key),
        openai_model=env.openai_model,
        ollama_base_url=env.ollama_base_url,
        ollama_model=env.ollama_model,
        litellm_base_url=env.litellm_base_url,
        litellm_model=env.litellm_model,
        litellm_api_key=_mask_api_key(env.litellm_api_key or ""),
    )


@router.patch("/llm", response_model=LlmSettingsResponse)
async def update_llm_settings(
    body: LlmSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Update current user's LLM settings."""
    env = get_settings()
    r = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    row = r.scalar_one_or_none()
    if not row:
        row = LlmSettings(user_id=user.id, llm_provider=env.llm_provider)
        db.add(row)
        await db.flush()

    if body.llm_provider is not None:
        row.llm_provider = body.llm_provider if body.llm_provider in ("openai", "ollama", "litellm") else row.llm_provider
    if body.openai_api_key is not None:
        val = body.openai_api_key.strip()
        # Don't overwrite with masked placeholder; empty string clears
        if val == "":
            row.openai_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.openai_api_key = val
    if body.openai_model is not None:
        row.openai_model = body.openai_model.strip() or None
    if body.ollama_base_url is not None:
        row.ollama_base_url = body.ollama_base_url.strip() or None
    if body.ollama_model is not None:
        row.ollama_model = body.ollama_model.strip() or None
    if body.litellm_base_url is not None:
        row.litellm_base_url = body.litellm_base_url.strip() or None
    if body.litellm_model is not None:
        row.litellm_model = body.litellm_model.strip() or None
    if body.litellm_api_key is not None:
        val = body.litellm_api_key.strip()
        if val == "":
            row.litellm_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.litellm_api_key = val

    await db.commit()
    await db.refresh(row)

    return LlmSettingsResponse(
        llm_provider=row.llm_provider,
        openai_api_key=_mask_api_key(row.openai_api_key),
        openai_model=row.openai_model or env.openai_model,
        ollama_base_url=row.ollama_base_url or env.ollama_base_url,
        ollama_model=row.ollama_model or env.ollama_model,
        litellm_base_url=row.litellm_base_url or env.litellm_base_url,
        litellm_model=row.litellm_model or env.litellm_model,
        litellm_api_key=_mask_api_key(row.litellm_api_key),
    )


@router.get("/litellm/models")
async def list_litellm_models(
    base_url: Optional[str] = Query(None, description="LiteLLM proxy base URL"),
    user: User = Depends(require_user),
):
    """Fetch available models from LiteLLM proxy (OpenAI /v1/models)."""
    env = get_settings()
    url_base = (base_url or env.litellm_base_url or "http://localhost:4000").rstrip("/")
    api_url = f"{url_base}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(api_url)
            r.raise_for_status()
            data = r.json()
        models = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}


@router.get("/ollama/models")
async def list_ollama_models(
    base_url: Optional[str] = Query(None, description="Ollama base URL (default from settings)"),
    user: User = Depends(require_user),
):
    """Fetch available models from Ollama server. Requires auth."""
    env = get_settings()
    url_base = (base_url or env.ollama_base_url or "http://localhost:11434").rstrip("/")
    api_url = f"{url_base}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(api_url)
            r.raise_for_status()
            data = r.json()
        models = [m.get("name", "").split(":")[0] for m in data.get("models", []) if m.get("name")]
        return {"models": list(dict.fromkeys(models))}  # dedupe
    except Exception as e:
        return {"models": [], "error": str(e)}
