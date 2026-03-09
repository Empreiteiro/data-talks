from datetime import datetime, timedelta
import secrets
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Agent, TelegramLinkToken, TelegramConnection, TelegramBotConfig
from app.auth import get_current_user
from app.config import get_settings

router = APIRouter(prefix="/telegram", tags=["Telegram"])


def _mask_token(token: str | None) -> str:
    if not token:
        return ""
    token = token.strip()
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


def _normalize_username(username: str) -> str:
    return username.strip().lstrip("@")


def _env_bot_option() -> dict | None:
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_bot_username:
        return None
    username = _normalize_username(settings.telegram_bot_username)
    return {
        "id": "env",
        "key": "env",
        "name": "Padrão (.env)",
        "bot_username": username,
        "bot_token": settings.telegram_bot_token,
        "masked_token": _mask_token(settings.telegram_bot_token),
        "is_env": True,
    }


class TelegramBotConfigCreate(BaseModel):
    name: str
    bot_token: str
    bot_username: str


class TelegramLinkRequest(BaseModel):
    bot_key: str | None = None


@router.get("/bot-configs")
async def list_bot_configs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    env_config = _env_bot_option()
    result = await db.execute(
        select(TelegramBotConfig)
        .where(TelegramBotConfig.user_id == current_user.id)
        .order_by(TelegramBotConfig.created_at.desc())
    )
    configs = result.scalars().all()
    return {
        "env_config": (
            {
                "id": env_config["id"],
                "key": env_config["key"],
                "name": env_config["name"],
                "bot_username": env_config["bot_username"],
                "masked_token": env_config["masked_token"],
                "is_env": True,
            }
            if env_config
            else None
        ),
        "configs": [
            {
                "id": cfg.id,
                "key": f"config:{cfg.id}",
                "name": cfg.name,
                "bot_username": cfg.bot_username,
                "masked_token": _mask_token(cfg.bot_token),
                "is_env": False,
                "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
            }
            for cfg in configs
        ],
    }


@router.post("/bot-configs")
async def create_bot_config(
    body: TelegramBotConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = body.name.strip()
    token = body.bot_token.strip()
    username = _normalize_username(body.bot_username)
    if not name:
        raise HTTPException(status_code=400, detail="Connection name is required")
    if not token:
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_TOKEN is required")
    if not username:
        raise HTTPException(status_code=400, detail="TELEGRAM_BOT_USERNAME is required")
    env_config = _env_bot_option()
    if env_config and env_config["bot_token"] == token:
        raise HTTPException(status_code=400, detail="This Telegram bot token is already configured as the default .env bot")
    existing = await db.execute(select(TelegramBotConfig).where(TelegramBotConfig.bot_token == token))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This Telegram bot token is already registered")

    cfg = TelegramBotConfig(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=name,
        bot_token=token,
        bot_username=username,
    )
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)

    return {
        "id": cfg.id,
        "key": f"config:{cfg.id}",
        "name": cfg.name,
        "bot_username": cfg.bot_username,
        "masked_token": _mask_token(cfg.bot_token),
        "is_env": False,
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
    }


@router.delete("/bot-configs/{config_id}")
async def delete_bot_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cfg = await db.get(TelegramBotConfig, config_id)
    if not cfg or cfg.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection config not found")
    await db.delete(cfg)
    await db.commit()
    return {"message": "Connection config removed successfully"}


async def _resolve_selected_bot(
    db: AsyncSession,
    user_id: str,
    bot_key: str | None,
) -> dict:
    env_config = _env_bot_option()
    requested_key = (bot_key or "").strip()
    if not requested_key and env_config:
        return env_config
    if requested_key in ("", "env"):
        if env_config:
            return env_config
        raise HTTPException(status_code=400, detail="Default Telegram bot is not configured on the server.")

    if not requested_key.startswith("config:"):
        raise HTTPException(status_code=400, detail="Invalid Telegram connection configuration")

    config_id = requested_key.split(":", 1)[1]
    cfg = await db.get(TelegramBotConfig, config_id)
    if not cfg or cfg.user_id != user_id:
        raise HTTPException(status_code=404, detail="Telegram connection configuration not found")
    return {
        "id": cfg.id,
        "key": f"config:{cfg.id}",
        "name": cfg.name,
        "bot_username": cfg.bot_username,
        "bot_token": cfg.bot_token,
        "masked_token": _mask_token(cfg.bot_token),
        "is_env": False,
    }


@router.post("/connection-link/{agent_id}")
async def generate_connection_link(
    agent_id: str,
    body: TelegramLinkRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generates a deep link to add the selected bot to a Telegram group and link it to the agent."""
    selected_bot = await _resolve_selected_bot(db, current_user.id, body.bot_key if body else None)

    # Verify agent ownership
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Generate a unique secure token (64 hex characters)
    token = secrets.token_hex(32)

    # Calculate expiration (e.g., 15 minutes from now)
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    link_token = TelegramLinkToken(
        id=secrets.token_hex(16),
        user_id=current_user.id,
        agent_id=agent_id,
        token=token,
        bot_key=selected_bot["key"],
        bot_username=selected_bot["bot_username"],
        telegram_bot_config_id=None if selected_bot["is_env"] else selected_bot["id"],
        expires_at=expires_at
    )
    db.add(link_token)
    await db.commit()

    # The startgroup parameter allows adding the bot to a group and passing the payload
    url = f"https://t.me/{selected_bot['bot_username']}?startgroup={token}"
    return {
        "url": url,
        "expires_at": expires_at.isoformat(),
        "bot_key": selected_bot["key"],
        "bot_username": selected_bot["bot_username"],
        "bot_name": selected_bot["name"],
    }


@router.get("/connections/{agent_id}")
async def get_connections(agent_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List active Telegram connections for a specific agent."""
    # Verify agent ownership
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    config_result = await db.execute(
        select(TelegramBotConfig).where(TelegramBotConfig.user_id == current_user.id)
    )
    config_map = {cfg.id: cfg for cfg in config_result.scalars().all()}

    result = await db.execute(
        select(TelegramConnection).where(
            TelegramConnection.agent_id == agent_id,
            TelegramConnection.user_id == current_user.id
        )
    )
    connections = result.scalars().all()

    return {
        "connections": [
            {
                "id": c.id,
                "chat_id": c.chat_id,
                "chat_title": c.chat_title,
                "created_at": c.created_at.isoformat(),
                "bot_key": c.bot_key,
                "bot_username": c.bot_username,
                "bot_name": (
                    "Padrão (.env)"
                    if c.bot_key == "env"
                    else config_map.get(c.telegram_bot_config_id).name
                    if c.telegram_bot_config_id and c.telegram_bot_config_id in config_map
                    else c.bot_username
                ),
            }
            for c in connections
        ]
    }

@router.delete("/connections/{connection_id}")
async def remove_connection(connection_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove a Telegram connection so the bot stops responding in that group."""
    conn = await db.get(TelegramConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")

    await db.delete(conn)
    await db.commit()
    return {"message": "Connection removed successfully"}
