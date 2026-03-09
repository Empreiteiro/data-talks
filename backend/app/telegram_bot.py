import asyncio
import httpx
import logging
import uuid
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import TelegramLinkToken, TelegramConnection, TelegramBotConfig, User
from app.config import get_settings

logger = logging.getLogger(__name__)

MAX_TELEGRAM_MESSAGE_LENGTH = 4000


def _normalize_username(username: str | None) -> str:
    return (username or "").strip().lstrip("@")


def _env_bot_runtime() -> dict | None:
    settings = get_settings()
    token = (settings.telegram_bot_token or "").strip()
    username = _normalize_username(settings.telegram_bot_username)
    if not token or not username:
        return None
    return {
        "key": "env",
        "config_id": None,
        "name": "Padrão (.env)",
        "token": token,
        "username": username,
    }


async def _db_bot_runtimes() -> list[dict]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TelegramBotConfig))
        configs = result.scalars().all()
    return [
        {
            "key": f"config:{cfg.id}",
            "config_id": cfg.id,
            "name": cfg.name,
            "token": cfg.bot_token,
            "username": _normalize_username(cfg.bot_username),
        }
        for cfg in configs
        if (cfg.bot_token or "").strip() and _normalize_username(cfg.bot_username)
    ]


async def handle_start_command(message: dict, db: AsyncSession, bot: dict):
    """Handles the /start <token> command to link a group/chat to an agent."""
    text = message.get("text", "")
    chat = message.get("chat", {})
    chat_id = str(chat.get("id"))
    chat_title = chat.get("title") or chat.get("username") or chat.get("first_name", "Unknown Chat")

    parts = text.split()
    if len(parts) < 2:
        return

    token_str = parts[1]
    stmt = select(TelegramLinkToken).where(TelegramLinkToken.token == token_str)
    result = await db.execute(stmt)
    link_token = result.scalar_one_or_none()

    if not link_token:
        logger.warning("Invalid Telegram link token received: %s", token_str)
        await send_telegram_message(bot["token"], chat_id, "Token de conexao invalido ou incorreto.")
        return

    if link_token.expires_at < datetime.utcnow():
        logger.warning("Expired Telegram link token: %s", token_str)
        await send_telegram_message(bot["token"], chat_id, "Este token de conexao expirou. Gere um novo no Data Talks.")
        await db.delete(link_token)
        await db.commit()
        return

    if link_token.bot_key and link_token.bot_key != bot["key"]:
        await send_telegram_message(bot["token"], chat_id, "Este link pertence a outra configuracao de bot.")
        return

    existing_conn_stmt = select(TelegramConnection).where(TelegramConnection.chat_id == chat_id)
    existing_conn = (await db.execute(existing_conn_stmt)).scalar_one_or_none()

    if existing_conn:
        existing_conn.agent_id = link_token.agent_id
        existing_conn.user_id = link_token.user_id
        existing_conn.chat_title = chat_title
        existing_conn.bot_key = link_token.bot_key or bot["key"]
        existing_conn.bot_username = link_token.bot_username or bot["username"]
        existing_conn.telegram_bot_config_id = link_token.telegram_bot_config_id
    else:
        new_conn = TelegramConnection(
            id=str(uuid.uuid4()),
            user_id=link_token.user_id,
            agent_id=link_token.agent_id,
            chat_id=chat_id,
            chat_title=chat_title,
            bot_key=link_token.bot_key or bot["key"],
            bot_username=link_token.bot_username or bot["username"],
            telegram_bot_config_id=link_token.telegram_bot_config_id,
        )
        db.add(new_conn)

    await db.delete(link_token)
    await db.commit()
    await send_telegram_message(
        bot["token"],
        chat_id,
        "Ola! Fui conectado a este chat com sucesso. Agora voce pode me enviar mensagens e eu responderei usando o agente configurado.",
    )


async def handle_message(message: dict, db: AsyncSession, bot: dict):
    """Processes a normal text message and responds using the connected agent."""
    chat_id = str(message.get("chat", {}).get("id"))
    text = (message.get("text", "") or "").strip()
    if not text:
        return

    result = await db.execute(select(TelegramConnection).where(TelegramConnection.chat_id == chat_id))
    connections = result.scalars().all()
    conn = next(
        (
            item
            for item in connections
            if (item.bot_key or "env") == bot["key"]
        ),
        None,
    )
    if not conn:
        return

    chat_type = message.get("chat", {}).get("type")
    bot_username = bot["username"]
    is_group = chat_type in ["group", "supergroup"]
    ask_command = f"/ask@{bot_username}" if bot_username else "/ask"
    is_ask_command = text.startswith("/ask ") or text == "/ask" or (bot_username and (text.startswith(f"{ask_command} ") or text == ask_command))
    mentioned = bot_username and f"@{bot_username}" in text
    reply_to_bot = message.get("reply_to_message", {}).get("from", {}).get("username") == bot_username

    if text.startswith("/") and not is_ask_command:
        return
    if is_group and not (mentioned or reply_to_bot or is_ask_command):
        return

    if mentioned:
        text = text.replace(f"@{bot_username}", "").strip()

    if is_ask_command:
        text = text.replace(ask_command, "", 1).replace("/ask", "", 1).strip()
        if not text:
            await send_telegram_message(
                bot["token"],
                chat_id,
                "Use `/ask sua pergunta` para falar comigo neste grupo.",
                reply_to_message_id=message.get("message_id"),
            )
            return

    user = await db.get(User, conn.user_id)
    if not user:
        logger.warning("User %s not found for telegram connection %s", conn.user_id, conn.id)
        return

    await send_telegram_action(bot["token"], chat_id, "typing")

    try:
        from app.routers.ask import ask_question
        from app.schemas import AskQuestionRequest

        request = AskQuestionRequest(
            question=text,
            agentId=conn.agent_id,
            channel="telegram",
        )
        response = await ask_question(request, db, user)
        answer = response.answer or "Desculpe, ocorreu um erro ao gerar a resposta."
        await send_telegram_message(bot["token"], chat_id, answer, reply_to_message_id=message.get("message_id"))
    except Exception as e:
        logger.error("Error answering telegram message: %s", e)
        await send_telegram_message(
            bot["token"],
            chat_id,
            "Desculpe, encontrei um erro interno ao tentar responder.",
            reply_to_message_id=message.get("message_id"),
        )


async def send_telegram_message(token: str, chat_id: str, text: str, reply_to_message_id: int = None):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    safe_text = (text or "").strip() or "Sem conteúdo para enviar."
    if len(safe_text) > MAX_TELEGRAM_MESSAGE_LENGTH:
        safe_text = safe_text[: MAX_TELEGRAM_MESSAGE_LENGTH - 1].rstrip() + "…"

    attempts = [
        {
            "chat_id": chat_id,
            "text": safe_text,
            "parse_mode": "Markdown",
            **({"reply_to_message_id": reply_to_message_id} if reply_to_message_id else {}),
        },
        {
            "chat_id": chat_id,
            "text": safe_text,
            **({"reply_to_message_id": reply_to_message_id} if reply_to_message_id else {}),
        },
        {
            "chat_id": chat_id,
            "text": safe_text,
        },
    ]

    async with httpx.AsyncClient() as client:
        last_error = None
        for payload in attempts:
            try:
                response = await client.post(url, json=payload)
                data = response.json()
                if response.status_code == 200 and data.get("ok"):
                    return
                last_error = data
                logger.warning("Telegram sendMessage rejected payload: %s", data)
            except Exception as e:
                last_error = str(e)
                logger.error(f"Failed to send telegram msg: {e}")

        logger.error("All Telegram sendMessage attempts failed for chat %s: %s", chat_id, last_error)

async def send_telegram_action(token: str, chat_id: str, action: str):
    url = f"https://api.telegram.org/bot{token}/sendChatAction"
    payload = {
        "chat_id": chat_id,
        "action": action
    }
    async with httpx.AsyncClient() as client:
        try:
             await client.post(url, json=payload)
        except Exception:
             pass


async def _poll_single_bot(bot: dict):
    logger.info("Starting Telegram Bot worker for %s", bot["username"])
    last_update_id = 0
    url = f"https://api.telegram.org/bot{bot['token']}/getUpdates"

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        while True:
            try:
                params = {
                    "offset": last_update_id + 1,
                    "timeout": 50,
                    "allowed_updates": ["message"],
                }
                response = await client.get(url, params=params)
                if response.status_code != 200:
                    logger.error("Telegram polling HTTP error for %s: %s", bot["username"], response.status_code)
                    await asyncio.sleep(5)
                    continue

                data = response.json()
                if not data.get("ok"):
                    logger.error("Telegram API returned error for %s: %s", bot["username"], data)
                    await asyncio.sleep(5)
                    continue

                updates = data.get("result", [])
                for update in updates:
                    update_id = update.get("update_id")
                    if update_id and update_id > last_update_id:
                        last_update_id = update_id

                    message = update.get("message")
                    if not message:
                        continue

                    text = message.get("text", "")
                    async with AsyncSessionLocal() as db:
                        if text.startswith("/start"):
                            await handle_start_command(message, db, bot)
                        else:
                            await handle_message(message, db, bot)
            except asyncio.CancelledError:
                logger.info("Telegram bot worker stopped for %s", bot["username"])
                raise
            except Exception as e:
                logger.error("Telegram polling error for %s: %s", bot["username"], e)
                await asyncio.sleep(5)


async def polling_worker():
    """Supervise polling tasks for env bot and user-managed Telegram bots."""
    tasks: dict[str, asyncio.Task] = {}
    idle_logged = False
    try:
        while True:
            bot_configs = []
            env_bot = _env_bot_runtime()
            if env_bot:
                bot_configs.append(env_bot)
            bot_configs.extend(await _db_bot_runtimes())

            desired = {bot["key"]: bot for bot in bot_configs}

            for key in list(tasks):
                if key not in desired:
                    tasks[key].cancel()
                    del tasks[key]

            for key, bot in desired.items():
                if key not in tasks or tasks[key].done():
                    tasks[key] = asyncio.create_task(_poll_single_bot(bot))

            if not desired and not tasks:
                if not idle_logged:
                    logger.info("No Telegram bot configurations available. Polling idle.")
                    idle_logged = True
            else:
                idle_logged = False

            await asyncio.sleep(10)
    except asyncio.CancelledError:
        for task in tasks.values():
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        logger.info("Telegram bot supervisor stopped.")

