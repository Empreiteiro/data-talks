import httpx
import logging
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import WhatsAppBotConfig, WhatsAppConnection, User

logger = logging.getLogger(__name__)

MAX_WHATSAPP_MESSAGE_LENGTH = 4096


def _mask_token(token: str | None) -> str:
    if not token:
        return ""
    token = token.strip()
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


async def send_whatsapp_message(access_token: str, phone_number_id: str, to: str, text: str):
    """Send a text message via the WhatsApp Cloud API."""
    safe_text = (text or "").strip() or "Sem conteúdo para enviar."
    if len(safe_text) > MAX_WHATSAPP_MESSAGE_LENGTH:
        safe_text = safe_text[: MAX_WHATSAPP_MESSAGE_LENGTH - 1].rstrip() + "…"

    url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": safe_text},
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            if response.status_code not in (200, 201):
                logger.error("WhatsApp API error (%s): %s", response.status_code, response.text)
        except Exception as e:
            logger.error("Failed to send WhatsApp message: %s", e)


async def handle_whatsapp_message(phone_number_id: str, from_number: str, text: str):
    """Look up the connected agent and answer the WhatsApp message."""
    async with AsyncSessionLocal() as db:
        conn_result = await db.execute(
            select(WhatsAppConnection).where(WhatsAppConnection.phone_number_id == phone_number_id)
        )
        conn = conn_result.scalar_one_or_none()
        if not conn:
            logger.info("No WhatsApp connection found for phone_number_id=%s", phone_number_id)
            return

        cfg = await db.get(WhatsAppBotConfig, conn.whatsapp_bot_config_id)
        if not cfg:
            logger.warning("WhatsApp config %s not found", conn.whatsapp_bot_config_id)
            return

        user = await db.get(User, conn.user_id)
        if not user:
            logger.warning("User %s not found for WhatsApp connection %s", conn.user_id, conn.id)
            return

        try:
            from app.routers.ask import ask_question
            from app.schemas import AskQuestionRequest

            request = AskQuestionRequest(
                question=text,
                agentId=conn.agent_id,
                channel="whatsapp",
            )
            response = await ask_question(request, db, user)
            answer = response.answer or "Desculpe, ocorreu um erro ao gerar a resposta."
            await send_whatsapp_message(cfg.access_token, phone_number_id, from_number, answer)
        except Exception as e:
            logger.error("Error answering WhatsApp message: %s", e)
            await send_whatsapp_message(
                cfg.access_token,
                phone_number_id,
                from_number,
                "Desculpe, encontrei um erro interno ao tentar responder.",
            )
