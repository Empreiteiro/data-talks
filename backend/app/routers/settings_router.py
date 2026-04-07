"""LLM and app settings API."""
import json
import os
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, LlmSettings, LlmConfig
from app.auth import require_user
from app.config import get_settings

router = APIRouter(prefix="/settings", tags=["settings"])


VALID_PROVIDERS = ("openai", "ollama", "litellm", "google", "anthropic", "claude-code")


class LlmSettingsResponse(BaseModel):
    llm_provider: str
    openai_api_key: Optional[str] = None  # Masked in response; empty if not set
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    openai_audio_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_audio_model: Optional[str] = None
    litellm_api_key: Optional[str] = None  # Masked
    google_api_key: Optional[str] = None  # Masked
    google_model: Optional[str] = None
    anthropic_api_key: Optional[str] = None  # Masked
    anthropic_model: Optional[str] = None
    claude_code_model: Optional[str] = None
    claude_code_oauth_token: Optional[str] = None  # Masked


class LlmSettingsUpdate(BaseModel):
    llm_provider: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    openai_audio_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_audio_model: Optional[str] = None
    litellm_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    google_model: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_model: Optional[str] = None
    claude_code_model: Optional[str] = None
    claude_code_oauth_token: Optional[str] = None


def _mask_api_key(key: str | None) -> str:
    """Return masked value for display (e.g. sk-...xyz) or empty if not set."""
    if not key or not key.strip():
        return ""
    k = key.strip()
    if len(k) <= 8:
        return "••••"
    return k[:4] + "••••" + k[-4:]


@router.get("/llm-status")
async def get_llm_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Check whether LLM is actually configured (env, account settings, or user configs).

    Returns { configured: bool, has_env: bool, has_configs: bool }.
    """
    env = get_settings()

    # Check env: provider must have the required credentials/connectivity
    has_env = False
    if env.llm_provider == "openai" and (env.openai_api_key or "").strip():
        has_env = True
    elif env.llm_provider == "ollama":
        has_env = True  # Ollama doesn't need API key
    elif env.llm_provider == "litellm":
        has_env = True  # LiteLLM proxy doesn't strictly need a key
    elif env.llm_provider == "google" and (env.google_api_key or "").strip():
        has_env = True
    elif env.llm_provider == "anthropic" and (env.anthropic_api_key or "").strip():
        has_env = True
    elif env.llm_provider == "claude-code":
        has_env = True  # Claude CLI uses OAuth token from file or env; no mandatory config

    # Check user LlmSettings (account-level override)
    has_account = False
    r = await db.execute(select(LlmSettings).where(LlmSettings.user_id == user.id))
    row = r.scalar_one_or_none()
    if row:
        provider = row.llm_provider or env.llm_provider
        if provider == "openai" and (row.openai_api_key or "").strip():
            has_account = True
        elif provider == "ollama":
            has_account = True
        elif provider == "litellm":
            has_account = True
        elif provider == "google" and (row.google_api_key or "").strip():
            has_account = True
        elif provider == "anthropic" and (row.anthropic_api_key or "").strip():
            has_account = True

    # Check user LlmConfigs
    r = await db.execute(select(LlmConfig).where(LlmConfig.user_id == user.id))
    configs = list(r.scalars().all())
    has_configs = len(configs) > 0

    configured = has_env or has_account or has_configs
    return {"configured": configured, "has_env": has_env, "has_account": has_account, "has_configs": has_configs}


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
            openai_base_url=row.openai_base_url or env.openai_base_url,
            openai_model=row.openai_model or env.openai_model,
            openai_audio_model=row.openai_audio_model or env.openai_audio_model,
            ollama_base_url=row.ollama_base_url or env.ollama_base_url,
            ollama_model=row.ollama_model or env.ollama_model,
            litellm_base_url=row.litellm_base_url or env.litellm_base_url,
            litellm_model=row.litellm_model or env.litellm_model,
            litellm_audio_model=row.litellm_audio_model or env.litellm_audio_model,
            litellm_api_key=_mask_api_key(row.litellm_api_key) if row.litellm_api_key else _mask_api_key(env.litellm_api_key or ""),
            google_api_key=_mask_api_key(row.google_api_key) if row.google_api_key else _mask_api_key(env.google_api_key),
            google_model=row.google_model or env.google_model,
            anthropic_api_key=_mask_api_key(row.anthropic_api_key) if row.anthropic_api_key else _mask_api_key(env.anthropic_api_key),
            anthropic_model=row.anthropic_model or env.anthropic_model,
            claude_code_model=row.claude_code_model or env.claude_code_model,
            claude_code_oauth_token=_mask_api_key(row.claude_code_oauth_token) if row.claude_code_oauth_token else _mask_api_key(env.claude_code_oauth_token),
        )
    return LlmSettingsResponse(
        llm_provider=env.llm_provider,
        openai_api_key=_mask_api_key(env.openai_api_key),
        openai_base_url=env.openai_base_url,
        openai_model=env.openai_model,
        openai_audio_model=env.openai_audio_model,
        ollama_base_url=env.ollama_base_url,
        ollama_model=env.ollama_model,
        litellm_base_url=env.litellm_base_url,
        litellm_model=env.litellm_model,
        litellm_audio_model=env.litellm_audio_model,
        litellm_api_key=_mask_api_key(env.litellm_api_key or ""),
        google_api_key=_mask_api_key(env.google_api_key),
        google_model=env.google_model,
        anthropic_api_key=_mask_api_key(env.anthropic_api_key),
        anthropic_model=env.anthropic_model,
        claude_code_model=env.claude_code_model,
        claude_code_oauth_token=_mask_api_key(env.claude_code_oauth_token),
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
        row.llm_provider = body.llm_provider if body.llm_provider in VALID_PROVIDERS else row.llm_provider
    if body.openai_api_key is not None:
        val = body.openai_api_key.strip()
        # Don't overwrite with masked placeholder; empty string clears
        if val == "":
            row.openai_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.openai_api_key = val
    if body.openai_base_url is not None:
        row.openai_base_url = body.openai_base_url.strip().rstrip("/") or None
    if body.openai_model is not None:
        row.openai_model = body.openai_model.strip() or None
    if body.openai_audio_model is not None:
        row.openai_audio_model = body.openai_audio_model.strip() or None
    if body.ollama_base_url is not None:
        row.ollama_base_url = body.ollama_base_url.strip() or None
    if body.ollama_model is not None:
        row.ollama_model = body.ollama_model.strip() or None
    if body.litellm_base_url is not None:
        row.litellm_base_url = body.litellm_base_url.strip() or None
    if body.litellm_model is not None:
        row.litellm_model = body.litellm_model.strip() or None
    if body.litellm_audio_model is not None:
        row.litellm_audio_model = body.litellm_audio_model.strip() or None
    if body.litellm_api_key is not None:
        val = body.litellm_api_key.strip()
        if val == "":
            row.litellm_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.litellm_api_key = val
    if body.google_api_key is not None:
        val = body.google_api_key.strip()
        if val == "":
            row.google_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.google_api_key = val
    if body.google_model is not None:
        row.google_model = body.google_model.strip() or None
    if body.anthropic_api_key is not None:
        val = body.anthropic_api_key.strip()
        if val == "":
            row.anthropic_api_key = None
        elif "••••" not in val and len(val) > 4:
            row.anthropic_api_key = val
    if body.anthropic_model is not None:
        row.anthropic_model = body.anthropic_model.strip() or None
    if body.claude_code_model is not None:
        row.claude_code_model = body.claude_code_model.strip() or None
    if body.claude_code_oauth_token is not None:
        val = body.claude_code_oauth_token.strip()
        if val == "":
            row.claude_code_oauth_token = None
        elif "••••" not in val and len(val) > 4:
            row.claude_code_oauth_token = val

    await db.commit()
    await db.refresh(row)

    return LlmSettingsResponse(
        llm_provider=row.llm_provider,
        openai_api_key=_mask_api_key(row.openai_api_key),
        openai_base_url=row.openai_base_url or env.openai_base_url,
        openai_model=row.openai_model or env.openai_model,
        openai_audio_model=row.openai_audio_model or env.openai_audio_model,
        ollama_base_url=row.ollama_base_url or env.ollama_base_url,
        ollama_model=row.ollama_model or env.ollama_model,
        litellm_base_url=row.litellm_base_url or env.litellm_base_url,
        litellm_model=row.litellm_model or env.litellm_model,
        litellm_audio_model=row.litellm_audio_model or env.litellm_audio_model,
        litellm_api_key=_mask_api_key(row.litellm_api_key),
        google_api_key=_mask_api_key(row.google_api_key),
        google_model=row.google_model or env.google_model,
        anthropic_api_key=_mask_api_key(row.anthropic_api_key),
        anthropic_model=row.anthropic_model or env.anthropic_model,
        claude_code_model=row.claude_code_model or env.claude_code_model,
        claude_code_oauth_token=_mask_api_key(row.claude_code_oauth_token),
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


@router.get("/google-sheets-service-email")
async def get_google_sheets_service_email(
    user: User = Depends(require_user),
):
    """
    Return the service account client_email from GOOGLE_SHEETS_SERVICE_ACCOUNT (JSON).
    Used by the frontend to show which email users must share their Google Sheet with.
    Returns null if not configured or invalid.
    """
    raw = os.environ.get("GOOGLE_SHEETS_SERVICE_ACCOUNT")
    if not raw or not raw.strip():
        return {"email": None}
    try:
        data = json.loads(raw.strip())
        email = (data or {}).get("client_email") if isinstance(data, dict) else None
        return {"email": email if isinstance(email, str) and email.strip() else None}
    except (json.JSONDecodeError, TypeError):
        return {"email": None}


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
        models = [m.get("name", "").strip() for m in data.get("models", []) if m.get("name")]
        return {"models": list(dict.fromkeys(models))}  # dedupe by full name
    except Exception as e:
        return {"models": [], "error": str(e)}


# --- LLM Configs (multiple per user, for list UI like Sources/Credentials) ---

class LlmConfigCreate(BaseModel):
    name: str
    llm_provider: str  # openai | ollama | litellm | google | anthropic | claude-code
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    openai_audio_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_audio_model: Optional[str] = None
    litellm_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    google_model: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_model: Optional[str] = None
    claude_code_model: Optional[str] = None
    claude_code_oauth_token: Optional[str] = None


class LlmConfigUpdate(BaseModel):
    name: Optional[str] = None
    llm_provider: Optional[str] = None
    is_default: Optional[bool] = None
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    openai_audio_model: Optional[str] = None
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    litellm_base_url: Optional[str] = None
    litellm_model: Optional[str] = None
    litellm_audio_model: Optional[str] = None
    litellm_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    google_model: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    anthropic_model: Optional[str] = None
    claude_code_model: Optional[str] = None
    claude_code_oauth_token: Optional[str] = None


def _config_to_response(c: LlmConfig, env) -> dict:
    # Display model: only use the one matching provider (fixes Ollama showing gpt-4o-mini)
    model = ""
    if c.llm_provider == "openai":
        model = c.openai_model or env.openai_model
    elif c.llm_provider == "ollama":
        model = c.ollama_model or env.ollama_model
    elif c.llm_provider == "litellm":
        model = c.litellm_model or env.litellm_model
    elif c.llm_provider == "google":
        model = c.google_model or env.google_model
    elif c.llm_provider == "anthropic":
        model = c.anthropic_model or env.anthropic_model
    elif c.llm_provider == "claude-code":
        model = c.claude_code_model or env.claude_code_model or "claude-code"
    return {
        "id": c.id,
        "name": c.name,
        "llm_provider": c.llm_provider,
        "model": model,
        "openai_api_key": _mask_api_key(c.openai_api_key) if c.openai_api_key else "",
        "openai_base_url": c.openai_base_url or env.openai_base_url,
        "openai_model": c.openai_model or env.openai_model,
        "openai_audio_model": c.openai_audio_model or env.openai_audio_model,
        "ollama_base_url": c.ollama_base_url or env.ollama_base_url,
        "ollama_model": c.ollama_model or env.ollama_model,
        "litellm_base_url": c.litellm_base_url or env.litellm_base_url,
        "litellm_model": c.litellm_model or env.litellm_model,
        "litellm_audio_model": c.litellm_audio_model or env.litellm_audio_model,
        "litellm_api_key": _mask_api_key(c.litellm_api_key) if c.litellm_api_key else "",
        "google_api_key": _mask_api_key(c.google_api_key) if c.google_api_key else "",
        "google_model": c.google_model or env.google_model,
        "anthropic_api_key": _mask_api_key(c.anthropic_api_key) if c.anthropic_api_key else "",
        "anthropic_model": c.anthropic_model or env.anthropic_model,
        "claude_code_model": c.claude_code_model or env.claude_code_model,
        "claude_code_oauth_token": _mask_api_key(c.claude_code_oauth_token) if c.claude_code_oauth_token else "",
        "is_default": getattr(c, "is_default", False),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/llm-configs")
async def list_llm_configs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """List all LLM configs for the current user."""
    env = get_settings()
    r = await db.execute(select(LlmConfig).where(LlmConfig.user_id == user.id).order_by(LlmConfig.created_at.desc()))
    configs = list(r.scalars().all())
    return [_config_to_response(c, env) for c in configs]


async def _auto_default_if_single(user_id: str, db: AsyncSession) -> None:
    """If there's exactly one LLM config for the user, mark it as default."""
    r = await db.execute(select(LlmConfig).where(LlmConfig.user_id == user_id))
    all_configs = r.scalars().all()
    if len(all_configs) == 1 and not all_configs[0].is_default:
        all_configs[0].is_default = True
        await db.commit()


@router.post("/llm-configs")
async def create_llm_config(
    body: LlmConfigCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Create a new LLM config."""
    env = get_settings()
    config_id = str(uuid.uuid4())
    def _opt(s: str | None) -> str | None:
        return (s or "").strip() or None

    c = LlmConfig(
        id=config_id,
        user_id=user.id,
        name=body.name.strip(),
        llm_provider=body.llm_provider if body.llm_provider in VALID_PROVIDERS else "openai",
        openai_api_key=_opt(body.openai_api_key),
        openai_base_url=_opt(body.openai_base_url.rstrip("/") if body.openai_base_url else None),
        openai_model=_opt(body.openai_model),
        openai_audio_model=_opt(body.openai_audio_model),
        ollama_base_url=_opt(body.ollama_base_url),
        ollama_model=_opt(body.ollama_model),
        litellm_base_url=_opt(body.litellm_base_url),
        litellm_model=_opt(body.litellm_model),
        litellm_audio_model=_opt(body.litellm_audio_model),
        litellm_api_key=_opt(body.litellm_api_key),
        google_api_key=_opt(body.google_api_key),
        google_model=_opt(body.google_model),
        anthropic_api_key=_opt(body.anthropic_api_key),
        anthropic_model=_opt(body.anthropic_model),
        claude_code_model=_opt(body.claude_code_model),
        claude_code_oauth_token=_opt(body.claude_code_oauth_token),
    )
    db.add(c)
    await db.commit()
    await _auto_default_if_single(user.id, db)
    await db.refresh(c)
    return _config_to_response(c, env)


@router.get("/llm-configs/{config_id}")
async def get_llm_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Get a single LLM config."""
    env = get_settings()
    r = await db.execute(select(LlmConfig).where(LlmConfig.id == config_id, LlmConfig.user_id == user.id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "LLM config not found")
    return _config_to_response(c, env)


@router.patch("/llm-configs/{config_id}")
async def update_llm_config(
    config_id: str,
    body: LlmConfigUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Update an LLM config."""
    env = get_settings()
    r = await db.execute(select(LlmConfig).where(LlmConfig.id == config_id, LlmConfig.user_id == user.id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "LLM config not found")
    if body.name is not None:
        c.name = body.name.strip()
    if body.llm_provider is not None and body.llm_provider in VALID_PROVIDERS:
        c.llm_provider = body.llm_provider
    if body.openai_api_key is not None:
        val = body.openai_api_key.strip()
        c.openai_api_key = None if val == "" else (val if "••••" not in val and len(val) > 4 else c.openai_api_key)
    if body.openai_base_url is not None:
        c.openai_base_url = body.openai_base_url.strip().rstrip("/") or None
    if body.openai_model is not None:
        c.openai_model = body.openai_model.strip() or None
    if body.openai_audio_model is not None:
        c.openai_audio_model = body.openai_audio_model.strip() or None
    if body.ollama_base_url is not None:
        c.ollama_base_url = body.ollama_base_url.strip() or None
    if body.ollama_model is not None:
        c.ollama_model = body.ollama_model.strip() or None
    if body.litellm_base_url is not None:
        c.litellm_base_url = body.litellm_base_url.strip() or None
    if body.litellm_model is not None:
        c.litellm_model = body.litellm_model.strip() or None
    if body.litellm_audio_model is not None:
        c.litellm_audio_model = body.litellm_audio_model.strip() or None
    if body.litellm_api_key is not None:
        val = body.litellm_api_key.strip()
        c.litellm_api_key = None if val == "" else (val if "••••" not in val and len(val) > 4 else c.litellm_api_key)
    if body.google_api_key is not None:
        val = body.google_api_key.strip()
        c.google_api_key = None if val == "" else (val if "••••" not in val and len(val) > 4 else c.google_api_key)
    if body.google_model is not None:
        c.google_model = body.google_model.strip() or None
    if body.anthropic_api_key is not None:
        val = body.anthropic_api_key.strip()
        c.anthropic_api_key = None if val == "" else (val if "••••" not in val and len(val) > 4 else c.anthropic_api_key)
    if body.anthropic_model is not None:
        c.anthropic_model = body.anthropic_model.strip() or None
    if body.claude_code_model is not None:
        c.claude_code_model = body.claude_code_model.strip() or None
    if body.claude_code_oauth_token is not None:
        val = body.claude_code_oauth_token.strip()
        c.claude_code_oauth_token = None if val == "" else (val if "••••" not in val and len(val) > 4 else c.claude_code_oauth_token)
    if body.is_default is True:
        # Unset other configs, set this one as default
        await db.execute(update(LlmConfig).where(LlmConfig.user_id == user.id).values(is_default=False))
        c.is_default = True
    elif body.is_default is False:
        c.is_default = False
    await db.commit()
    await db.refresh(c)
    return _config_to_response(c, env)


@router.delete("/llm-configs/{config_id}")
async def delete_llm_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Delete an LLM config."""
    r = await db.execute(select(LlmConfig).where(LlmConfig.id == config_id, LlmConfig.user_id == user.id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "LLM config not found")
    await db.delete(c)
    await db.commit()
    await _auto_default_if_single(user.id, db)
    return {"ok": True}
