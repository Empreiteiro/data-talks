"""CRUD for outgoing webhooks."""
import uuid
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Webhook
from app.auth import require_user

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class WebhookCreate(BaseModel):
    name: str
    url: str
    agent_id: str | None = None
    events: list[str] = []
    headers: dict | None = None
    secret: str | None = None


class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    agent_id: str | None = None
    events: list[str] | None = None
    headers: dict | None = None
    is_active: bool | None = None


def _serialize(wh: Webhook) -> dict:
    return {
        "id": wh.id,
        "name": wh.name,
        "url": wh.url,
        "agent_id": wh.agent_id,
        "events": wh.events or [],
        "headers": wh.headers,
        "secret": "***" if wh.secret else None,
        "is_active": wh.is_active,
        "last_triggered_at": wh.last_triggered_at.isoformat() if wh.last_triggered_at else None,
        "last_status_code": wh.last_status_code,
        "created_at": wh.created_at.isoformat(),
    }


@router.get("")
async def list_webhooks(
    agent_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    q = select(Webhook).where(Webhook.user_id == user.id).order_by(Webhook.created_at.desc())
    if agent_id:
        q = q.where(Webhook.agent_id == agent_id)
    r = await db.execute(q)
    return [_serialize(w) for w in r.scalars().all()]


@router.post("")
async def create_webhook(
    body: WebhookCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    wh = Webhook(
        id=str(uuid.uuid4()),
        user_id=user.id,
        name=body.name,
        url=body.url,
        agent_id=body.agent_id,
        events=body.events or ["alert.executed", "report.generated"],
        headers=body.headers,
        secret=body.secret or secrets.token_hex(32),
        is_active=True,
    )
    db.add(wh)
    await db.commit()
    # Return full secret only on creation
    result = _serialize(wh)
    result["secret"] = wh.secret
    return result


@router.patch("/{webhook_id}")
async def update_webhook(
    webhook_id: str,
    body: WebhookUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    r = await db.execute(select(Webhook).where(Webhook.id == webhook_id, Webhook.user_id == user.id))
    wh = r.scalar_one_or_none()
    if not wh:
        raise HTTPException(404, "Webhook not found")
    if body.name is not None:
        wh.name = body.name
    if body.url is not None:
        wh.url = body.url
    if body.agent_id is not None:
        wh.agent_id = body.agent_id
    if body.events is not None:
        wh.events = body.events
    if body.headers is not None:
        wh.headers = body.headers
    if body.is_active is not None:
        wh.is_active = body.is_active
    await db.commit()
    return _serialize(wh)


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    r = await db.execute(select(Webhook).where(Webhook.id == webhook_id, Webhook.user_id == user.id))
    wh = r.scalar_one_or_none()
    if not wh:
        raise HTTPException(404, "Webhook not found")
    await db.delete(wh)
    await db.commit()
    return {"ok": True}
