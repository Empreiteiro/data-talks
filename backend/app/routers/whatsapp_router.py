import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Agent, WhatsAppBotConfig, WhatsAppConnection
from app.auth import get_current_user
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])


def _mask_token(token: str | None) -> str:
    if not token:
        return ""
    token = token.strip()
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


def _env_config_option() -> dict | None:
    settings = get_settings()
    if not settings.whatsapp_phone_number_id or not settings.whatsapp_access_token or not settings.whatsapp_verify_token:
        return None
    return {
        "id": "env",
        "key": "env",
        "name": "Padrão (.env)",
        "phone_number_id": settings.whatsapp_phone_number_id,
        "masked_token": _mask_token(settings.whatsapp_access_token),
        "verify_token": settings.whatsapp_verify_token,
        "is_env": True,
    }


# ── Bot Config CRUD ──────────────────────────────────────────────────────────


class WhatsAppBotConfigCreate(BaseModel):
    name: str
    phone_number_id: str
    access_token: str
    verify_token: str


@router.get("/bot-configs")
async def list_bot_configs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    env_config = _env_config_option()
    result = await db.execute(
        select(WhatsAppBotConfig)
        .where(WhatsAppBotConfig.user_id == current_user.id)
        .order_by(WhatsAppBotConfig.created_at.desc())
    )
    configs = result.scalars().all()
    return {
        "env_config": (
            {
                "id": env_config["id"],
                "key": env_config["key"],
                "name": env_config["name"],
                "phone_number_id": env_config["phone_number_id"],
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
                "phone_number_id": cfg.phone_number_id,
                "masked_token": _mask_token(cfg.access_token),
                "is_env": False,
                "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
            }
            for cfg in configs
        ],
    }


@router.post("/bot-configs")
async def create_bot_config(
    body: WhatsAppBotConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = body.name.strip()
    phone_number_id = body.phone_number_id.strip()
    access_token = body.access_token.strip()
    verify_token = body.verify_token.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Connection name is required")
    if not phone_number_id:
        raise HTTPException(status_code=400, detail="Phone Number ID is required")
    if not access_token:
        raise HTTPException(status_code=400, detail="Access Token is required")
    if not verify_token:
        raise HTTPException(status_code=400, detail="Verify Token is required")

    existing = await db.execute(
        select(WhatsAppBotConfig).where(
            WhatsAppBotConfig.phone_number_id == phone_number_id,
            WhatsAppBotConfig.user_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This Phone Number ID is already registered")

    cfg = WhatsAppBotConfig(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=name,
        phone_number_id=phone_number_id,
        access_token=access_token,
        verify_token=verify_token,
    )
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)

    return {
        "id": cfg.id,
        "key": f"config:{cfg.id}",
        "name": cfg.name,
        "phone_number_id": cfg.phone_number_id,
        "masked_token": _mask_token(cfg.access_token),
        "is_env": False,
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
    }


@router.delete("/bot-configs/{config_id}")
async def delete_bot_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cfg = await db.get(WhatsAppBotConfig, config_id)
    if not cfg or cfg.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="WhatsApp config not found")

    # Remove all connections tied to this config
    conn_result = await db.execute(
        select(WhatsAppConnection).where(WhatsAppConnection.whatsapp_bot_config_id == config_id)
    )
    for conn in conn_result.scalars().all():
        await db.delete(conn)

    await db.delete(cfg)
    await db.commit()
    return {"message": "WhatsApp config removed successfully"}


# ── Agent Connections ─────────────────────────────────────────────────────────


class WhatsAppConnectRequest(BaseModel):
    config_key: str  # "env" or "config:<uuid>"


@router.post("/connections/{agent_id}")
async def create_connection(
    agent_id: str,
    body: WhatsAppConnectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Link a WhatsApp phone number to an agent."""
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Resolve config
    env_cfg = _env_config_option()
    cfg_key = body.config_key.strip()

    if cfg_key in ("", "env"):
        if not env_cfg:
            raise HTTPException(status_code=400, detail="Default WhatsApp config is not set on the server.")
        phone_number_id = env_cfg["phone_number_id"]
        cfg_id = "env"
        cfg_name = env_cfg["name"]
        access_token = get_settings().whatsapp_access_token
    elif cfg_key.startswith("config:"):
        config_id = cfg_key.split(":", 1)[1]
        db_cfg = await db.get(WhatsAppBotConfig, config_id)
        if not db_cfg or db_cfg.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="WhatsApp config not found")
        phone_number_id = db_cfg.phone_number_id
        cfg_id = db_cfg.id
        cfg_name = db_cfg.name
        access_token = db_cfg.access_token
    else:
        raise HTTPException(status_code=400, detail="Invalid config key")

    # Check if this phone number is already connected to another agent
    existing_result = await db.execute(
        select(WhatsAppConnection).where(WhatsAppConnection.phone_number_id == phone_number_id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        if existing.agent_id == agent_id:
            raise HTTPException(status_code=400, detail="This WhatsApp number is already connected to this agent")
        # Reassign to new agent
        existing.agent_id = agent_id
        existing.user_id = current_user.id
        existing.whatsapp_bot_config_id = cfg_id
        existing.config_name = cfg_name
        await db.commit()
        await db.refresh(existing)
        return {
            "id": existing.id,
            "agent_id": existing.agent_id,
            "phone_number_id": existing.phone_number_id,
            "config_name": existing.config_name,
            "created_at": existing.created_at.isoformat(),
        }

    conn = WhatsAppConnection(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        agent_id=agent_id,
        whatsapp_bot_config_id=cfg_id,
        phone_number_id=phone_number_id,
        config_name=cfg_name,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    return {
        "id": conn.id,
        "agent_id": conn.agent_id,
        "phone_number_id": conn.phone_number_id,
        "config_name": conn.config_name,
        "created_at": conn.created_at.isoformat(),
    }


@router.get("/connections/{agent_id}")
async def get_connections(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List active WhatsApp connections for a specific agent."""
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    result = await db.execute(
        select(WhatsAppConnection).where(
            WhatsAppConnection.agent_id == agent_id,
            WhatsAppConnection.user_id == current_user.id,
        )
    )
    connections = result.scalars().all()

    return {
        "connections": [
            {
                "id": c.id,
                "phone_number_id": c.phone_number_id,
                "config_name": c.config_name,
                "created_at": c.created_at.isoformat(),
            }
            for c in connections
        ]
    }


@router.delete("/connections/{connection_id}")
async def remove_connection(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a WhatsApp connection."""
    conn = await db.get(WhatsAppConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    await db.delete(conn)
    await db.commit()
    return {"message": "Connection removed successfully"}


# ── Webhook (public) ──────────────────────────────────────────────────────────


@router.get("/webhook")
async def webhook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    db: AsyncSession = Depends(get_db),
):
    """Meta webhook verification challenge."""
    if hub_mode != "subscribe" or not hub_verify_token or not hub_challenge:
        raise HTTPException(status_code=400, detail="Invalid verification request")

    # Check env config
    settings = get_settings()
    if settings.whatsapp_verify_token and settings.whatsapp_verify_token == hub_verify_token:
        return int(hub_challenge)

    # Check DB configs
    result = await db.execute(select(WhatsAppBotConfig))
    for cfg in result.scalars().all():
        if cfg.verify_token == hub_verify_token:
            return int(hub_challenge)

    raise HTTPException(status_code=403, detail="Verify token mismatch")


@router.post("/webhook")
async def webhook_receive(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Receive incoming WhatsApp messages from Meta and route them to the connected agent."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Parse Cloud API payload
    entry = data.get("entry", [])
    for e in entry:
        for change in e.get("changes", []):
            value = change.get("value", {})
            phone_number_id = value.get("metadata", {}).get("phone_number_id")
            messages = value.get("messages", [])
            for msg in messages:
                if msg.get("type") != "text":
                    continue
                from_number = msg.get("from")
                text = (msg.get("text") or {}).get("body", "").strip()
                if not text or not from_number or not phone_number_id:
                    continue

                from app.whatsapp_bot import handle_whatsapp_message
                background_tasks.add_task(handle_whatsapp_message, phone_number_id, from_number, text)

    return {"status": "ok"}
