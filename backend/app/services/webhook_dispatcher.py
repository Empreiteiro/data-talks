"""Async webhook dispatcher with HMAC signing and retry logic."""
import hashlib
import hmac
import json
import logging
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Webhook

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAYS = [2, 4, 8]  # seconds


def _sign_payload(payload_bytes: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()


async def dispatch_webhooks(
    db: AsyncSession,
    user_id: str,
    event: str,
    payload: dict,
    agent_id: str | None = None,
) -> int:
    """Fire all matching active webhooks for a user/event. Returns count of successful dispatches."""
    q = select(Webhook).where(
        Webhook.user_id == user_id,
        Webhook.is_active == True,
    )
    if agent_id:
        from sqlalchemy import or_
        q = q.where(or_(Webhook.agent_id == agent_id, Webhook.agent_id.is_(None)))

    result = await db.execute(q)
    webhooks = list(result.scalars().all())

    fired = 0
    for wh in webhooks:
        if wh.events and event not in wh.events:
            continue
        success = await _fire_webhook(wh, event, payload)
        wh.last_triggered_at = datetime.utcnow()
        wh.last_status_code = 200 if success else 0
        if success:
            fired += 1

    await db.flush()
    return fired


async def _fire_webhook(wh: Webhook, event: str, payload: dict) -> bool:
    body = json.dumps({"event": event, "data": payload, "timestamp": datetime.utcnow().isoformat()})
    body_bytes = body.encode()

    headers = {"Content-Type": "application/json"}
    if wh.secret:
        headers["X-Webhook-Signature"] = _sign_payload(body_bytes, wh.secret)
    if wh.headers:
        headers.update(wh.headers)

    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(wh.url, content=body_bytes, headers=headers)
            wh.last_status_code = resp.status_code
            if resp.status_code < 400:
                logger.info("Webhook %s fired: %s → %d", wh.id, wh.url, resp.status_code)
                return True
            logger.warning("Webhook %s got %d from %s (attempt %d)", wh.id, resp.status_code, wh.url, attempt + 1)
        except Exception:
            logger.exception("Webhook %s failed to reach %s (attempt %d)", wh.id, wh.url, attempt + 1)

        if attempt < MAX_RETRIES - 1:
            import asyncio
            await asyncio.sleep(RETRY_DELAYS[attempt])

    return False
