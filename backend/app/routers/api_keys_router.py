"""CRUD for external API keys (JWT-protected)."""
import uuid
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth import TenantScope, require_membership, require_user, _hash_api_key
from app.services.tenant_scope import tenant_filter
from app.models import User, Agent, ApiKey
from app.schemas import ApiKeyCreate, ApiKeyOut, ApiKeyCreated

router = APIRouter(prefix="/api-keys", tags=["api-keys"])

KEY_PREFIX = "dtk_"
KEY_RANDOM_LENGTH = 48  # random URL-safe bytes after prefix


def _generate_raw_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(KEY_RANDOM_LENGTH)


def _row_to_out(k: ApiKey) -> ApiKeyOut:
    return ApiKeyOut(
        id=k.id,
        agent_id=k.agent_id,
        name=k.name,
        key_prefix=k.key_prefix,
        scopes=k.scopes or [],
        is_active=k.is_active,
        last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        created_at=k.created_at.isoformat(),
    )


@router.get("")
async def list_api_keys(
    agent_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    q = select(ApiKey).where(tenant_filter(ApiKey, scope)).order_by(ApiKey.created_at.desc())
    if agent_id:
        q = q.where(ApiKey.agent_id == agent_id)
    result = await db.execute(q)
    keys = result.scalars().all()
    return [_row_to_out(k) for k in keys]


@router.post("")
async def create_api_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    # Verify agent exists and belongs to user
    r = await db.execute(select(Agent).where(Agent.id == body.agent_id, tenant_filter(Agent, scope)))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Agent not found")

    raw_key = _generate_raw_key()
    api_key = ApiKey(
        id=str(uuid.uuid4()),
        user_id=user.id,
        agent_id=body.agent_id,
        name=body.name,
        key_hash=_hash_api_key(raw_key),
        key_prefix=raw_key[:12],
        scopes=["ask"],
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(api_key)
    await db.commit()

    return ApiKeyCreated(
        id=api_key.id,
        agent_id=api_key.agent_id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        scopes=api_key.scopes or [],
        is_active=api_key.is_active,
        last_used_at=None,
        created_at=api_key.created_at.isoformat(),
        raw_key=raw_key,
    )


@router.delete("/{key_id}")
async def delete_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(ApiKey).where(ApiKey.id == key_id, tenant_filter(ApiKey, scope)))
    key = r.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API key not found")
    await db.delete(key)
    await db.commit()
    return {"ok": True}


@router.patch("/{key_id}")
async def update_api_key(
    key_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(ApiKey).where(ApiKey.id == key_id, tenant_filter(ApiKey, scope)))
    key = r.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API key not found")
    if "name" in body:
        key.name = body["name"]
    if "is_active" in body:
        key.is_active = bool(body["is_active"])
    await db.commit()
    return _row_to_out(key)
