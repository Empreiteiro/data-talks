import asyncio
import httpx
import logging
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import TelegramLinkToken, TelegramConnection, Agent, QASession
from app.config import get_settings

logger = logging.getLogger(__name__)

async def handle_start_command(message: dict, db: AsyncSession, bot_token: str):
    """Handles the /start <token> command to link a group/chat to an agent."""
    text = message.get("text", "")
    chat = message.get("chat", {})
    chat_id = str(chat.get("id"))
    chat_title = chat.get("title") or chat.get("username") or chat.get("first_name", "Unknown Chat")

    parts = text.split()
    if len(parts) < 2:
        return  # Just a regular /start without a token

    token_str = parts[1]

    # Verify if the token exists and is valid
    stmt = select(TelegramLinkToken).where(TelegramLinkToken.token == token_str)
    result = await db.execute(stmt)
    link_token = result.scalar_one_or_none()

    if not link_token:
        logger.warning(f"Invalid Telegram link token received: {token_str}")
        await send_telegram_message(bot_token, chat_id, "Token de conexão inválido ou incorreto.")
        return

    if link_token.expires_at < datetime.utcnow():
        logger.warning(f"Expired Telegram link token: {token_str}")
        await send_telegram_message(bot_token, chat_id, "Este token de conexão expirou. Por favor, gere um novo no Data Talks.")
        # Delete expired
        await db.delete(link_token)
        await db.commit()
        return

    # Create the connection
    # Check if this chat_id is already connected
    existing_conn_stmt = select(TelegramConnection).where(TelegramConnection.chat_id == chat_id)
    existing_conn = (await db.execute(existing_conn_stmt)).scalar_one_or_none()
    
    if existing_conn:
        existing_conn.agent_id = link_token.agent_id
        existing_conn.user_id = link_token.user_id
        existing_conn.chat_title = chat_title
    else:
        new_conn = TelegramConnection(
            id=f"tg_{chat_id}_{link_token.agent_id}",
            user_id=link_token.user_id,
            agent_id=link_token.agent_id,
            chat_id=chat_id,
            chat_title=chat_title
        )
        db.add(new_conn)

    # Clean up the token
    await db.delete(link_token)
    await db.commit()

    await send_telegram_message(bot_token, chat_id, "✅ Olá! Fui conectado a este chat com sucesso. Agora você pode me enviar mensagens e eu responderei usando o agente configurado.")


async def handle_message(message: dict, db: AsyncSession, bot_token: str):
    """Processes a normal text message and responds using the connected agent."""
    chat_id = str(message.get("chat", {}).get("id"))
    text = message.get("text", "")

    if not text or text.startswith("/"):
        return

    # Find connection
    stmt = select(TelegramConnection).where(TelegramConnection.chat_id == chat_id)
    conn = (await db.execute(stmt)).scalar_one_or_none()
    if not conn:
        return # Do not respond if not connected

    # Check if we are mentioned or if it is a direct message
    chat_type = message.get("chat", {}).get("type")
    
    # In groups, we should only answer if mentioned or replied to, to avoid spam
    bot_username = get_settings().telegram_bot_username
    is_group = chat_type in ["group", "supergroup"]
    mentioned = bot_username and f"@{bot_username}" in text
    reply_to_bot = message.get("reply_to_message", {}).get("from", {}).get("username") == bot_username

    if is_group and not (mentioned or reply_to_bot):
        return
        
    if mentioned:
       text = text.replace(f"@{bot_username}", "").strip()

    # Create mock current user instance to bypass authentication for API call
    from app.models import User
    user = await db.get(User, conn.user_id)
    if not user:
         logger.warning(f"User {conn.user_id} not found for telegram connection {conn.id}")
         return
         
    # Call AskAgent (reuse logic)
    # We send a typing action first
    await send_telegram_action(bot_token, chat_id, "typing")

    try:
        from app.routers.ask import ask_question
        from app.schemas import AskQuestionRequest
        
        request = AskQuestionRequest(
            question=text,
            agentId=conn.agent_id,
        )
        response = await ask_question(request, db, user)

        # Parse the reply
        answer = response.answer or "Desculpe, ocorreu um erro ao gerar a resposta."
        
        # If there's an image (chart), we could send it, but let's stick to text for now
        # Send text back
        await send_telegram_message(bot_token, chat_id, answer, reply_to_message_id=message.get("message_id"))

    except Exception as e:
        logger.error(f"Error answering telegram message: {e}")
        await send_telegram_message(bot_token, chat_id, "Desculpe, encontrei um erro interno ao tentar responder.", reply_to_message_id=message.get("message_id"))


async def send_telegram_message(token: str, chat_id: str, text: str, reply_to_message_id: int = None):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown"  # Or HTML
    }
    if reply_to_message_id:
        payload["reply_to_message_id"] = reply_to_message_id

    async with httpx.AsyncClient() as client:
        try:
             await client.post(url, json=payload)
        except Exception as e:
            logger.error(f"Failed to send telegram msg: {e}")

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


async def polling_worker():
    """Background task that long-polls the telegram getUpdates API."""
    settings = get_settings()
    token = settings.telegram_bot_token
    if not token:
        logger.info("No TELEGRAM_BOT_TOKEN set. Telegram bot polling disabled.")
        return

    logger.info("Starting Telegram Bot long-polling worker...")
    last_update_id = 0
    url = f"https://api.telegram.org/bot{token}/getUpdates"

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        while True:
            try:
                # long polling params
                params = {
                    "offset": last_update_id + 1,
                    "timeout": 50,  # blocks for 50s waiting for updates
                    "allowed_updates": ["message"]
                }
                
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    
                    if not data.get("ok"):
                        logger.error(f"Telegram API returned error: {data}")
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
                                await handle_start_command(message, db, token)
                            else:
                                await handle_message(message, db, token)

            except asyncio.CancelledError:
                logger.info("Telegram Bot polling stopped.")
                break
            except Exception as e:
                logger.error(f"Telegram polling error: {e}")
                await asyncio.sleep(5)  # wait before retrying

