from datetime import datetime, timedelta
import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Agent, TelegramLinkToken, TelegramConnection
from app.auth import get_current_user
from app.config import get_settings

router = APIRouter(prefix="/telegram", tags=["Telegram"])

@router.post("/connection-link/{agent_id}")
async def generate_connection_link(agent_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Generates a deep link to add the bot to a Telegram group and link it to the agent."""
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_bot_username:
        raise HTTPException(status_code=500, detail="Telegram bot is not configured on the server.")

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
        expires_at=expires_at
    )
    db.add(link_token)
    await db.commit()

    # The startgroup parameter allows adding the bot to a group and passing the payload
    url = f"https://t.me/{settings.telegram_bot_username}?startgroup={token}"
    return {"url": url, "expires_at": expires_at.isoformat()}


@router.get("/connections/{agent_id}")
async def get_connections(agent_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List active Telegram connections for a specific agent."""
    # Verify agent ownership
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

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
                "created_at": c.created_at.isoformat()
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
