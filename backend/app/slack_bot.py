import hashlib
import hmac
import logging
import time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SlackBotConfig, SlackConnection, User

logger = logging.getLogger(__name__)

MAX_SLACK_MESSAGE_LENGTH = 4000


def verify_slack_signature(
    signing_secret: str,
    timestamp: str,
    body: bytes,
    signature: str,
) -> bool:
    """Verify Slack request signature (HMAC-SHA256)."""
    if abs(time.time() - int(timestamp)) > 60 * 5:
        return False
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed = "v0=" + hmac.new(
        signing_secret.encode(), sig_basestring.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


async def send_slack_message(
    token: str,
    channel_id: str,
    text: str,
    thread_ts: str | None = None,
) -> dict | None:
    """Send a message to a Slack channel via chat.postMessage."""
    safe_text = (text or "").strip() or "No content to send."
    if len(safe_text) > MAX_SLACK_MESSAGE_LENGTH:
        safe_text = safe_text[: MAX_SLACK_MESSAGE_LENGTH - 1].rstrip() + "\u2026"

    payload = {
        "channel": channel_id,
        "text": safe_text,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "https://slack.com/api/chat.postMessage",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
            data = response.json()
            if not data.get("ok"):
                logger.error("Slack chat.postMessage error: %s", data.get("error"))
            return data
        except Exception as e:
            logger.error("Failed to send Slack message: %s", e)
            return None


async def handle_event_callback(event: dict, db: AsyncSession):
    """Process a Slack event_callback (app_mention or message.im)."""
    event_data = event.get("event", {})
    event_type = event_data.get("type")
    channel_id = event_data.get("channel")
    text = (event_data.get("text") or "").strip()
    thread_ts = event_data.get("thread_ts") or event_data.get("ts")
    team_id = event.get("team_id")

    if event_data.get("subtype") == "bot_message" or event_data.get("bot_id"):
        return

    if not text or not channel_id:
        return

    result = await db.execute(
        select(SlackConnection).where(SlackConnection.channel_id == channel_id)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return

    config = await db.get(SlackBotConfig, conn.slack_bot_config_id)
    if not config or not config.bot_token:
        return

    if event_type == "app_mention":
        bot_user_id = event.get("authorizations", [{}])[0].get("user_id", "")
        if bot_user_id:
            text = text.replace(f"<@{bot_user_id}>", "").strip()

    if not text:
        return

    user = await db.get(User, conn.user_id)
    if not user:
        logger.warning("User %s not found for Slack connection %s", conn.user_id, conn.id)
        return

    try:
        from app.routers.ask import ask_question
        from app.schemas import AskQuestionRequest

        request = AskQuestionRequest(
            question=text,
            agentId=conn.agent_id,
            channel="slack",
        )
        response = await ask_question(request, db, user)
        answer = response.answer or "Sorry, an error occurred while generating the response."
        await send_slack_message(config.bot_token, channel_id, answer, thread_ts=thread_ts)
    except Exception as e:
        logger.error("Error answering Slack message: %s", e)
        await send_slack_message(
            config.bot_token,
            channel_id,
            "Sorry, I encountered an internal error while trying to respond.",
            thread_ts=thread_ts,
        )


async def handle_slash_command(
    channel_id: str,
    text: str,
    team_id: str,
    db: AsyncSession,
) -> str:
    """Process a Slack slash command (/ask) and return the response text."""
    if not text.strip():
        return "Usage: `/ask your question here`"

    result = await db.execute(
        select(SlackConnection).where(SlackConnection.channel_id == channel_id)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return "This channel is not connected to any Data Talks agent. Connect it in the Data Talks workspace first."

    config = await db.get(SlackBotConfig, conn.slack_bot_config_id)
    if not config or not config.bot_token:
        return "Slack bot configuration not found or missing token."

    user = await db.get(User, conn.user_id)
    if not user:
        return "User not found for this connection."

    try:
        from app.routers.ask import ask_question
        from app.schemas import AskQuestionRequest

        request = AskQuestionRequest(
            question=text.strip(),
            agentId=conn.agent_id,
            channel="slack",
        )
        response = await ask_question(request, db, user)
        return response.answer or "Sorry, an error occurred while generating the response."
    except Exception as e:
        logger.error("Error answering Slack slash command: %s", e)
        return "Sorry, I encountered an internal error while trying to respond."
