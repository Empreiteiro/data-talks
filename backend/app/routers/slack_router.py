import secrets
import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models import Agent, SlackBotConfig, SlackConnection, SlackOAuthState, User
from app.slack_bot import handle_event_callback, handle_slash_command, verify_slack_signature

router = APIRouter(prefix="/slack", tags=["Slack"])

SLACK_OAUTH_SCOPES = "chat:write,app_mentions:read,commands,channels:read,im:read,im:history"


def _mask_token(token: str | None) -> str:
    if not token:
        return ""
    token = token.strip()
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


def _env_bot_option() -> dict | None:
    settings = get_settings()
    if not settings.slack_bot_token or not settings.slack_signing_secret:
        return None
    return {
        "id": "env",
        "key": "env",
        "name": "Default (.env)",
        "bot_token": settings.slack_bot_token,
        "signing_secret": settings.slack_signing_secret,
        "client_id": settings.slack_client_id,
        "client_secret": settings.slack_client_secret,
        "masked_token": _mask_token(settings.slack_bot_token),
        "team_id": None,
        "team_name": None,
        "is_env": True,
    }


class SlackBotConfigCreate(BaseModel):
    name: str
    client_id: str
    client_secret: str
    signing_secret: str


class SlackChannelConnect(BaseModel):
    config_key: str
    channel_id: str


# ── Bot config CRUD ──────────────────────────────────────────────────

@router.get("/bot-configs")
async def list_bot_configs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    env_config = _env_bot_option()
    result = await db.execute(
        select(SlackBotConfig)
        .where(SlackBotConfig.user_id == current_user.id)
        .order_by(SlackBotConfig.created_at.desc())
    )
    configs = result.scalars().all()
    return {
        "env_config": (
            {
                "id": env_config["id"],
                "key": env_config["key"],
                "name": env_config["name"],
                "masked_token": env_config["masked_token"],
                "team_id": env_config["team_id"],
                "team_name": env_config["team_name"],
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
                "masked_token": _mask_token(cfg.bot_token),
                "team_id": cfg.team_id,
                "team_name": cfg.team_name,
                "is_env": False,
                "has_token": bool(cfg.bot_token),
                "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
            }
            for cfg in configs
        ],
    }


@router.post("/bot-configs")
async def create_bot_config(
    body: SlackBotConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Connection name is required")
    if not body.client_id.strip():
        raise HTTPException(status_code=400, detail="Slack Client ID is required")
    if not body.client_secret.strip():
        raise HTTPException(status_code=400, detail="Slack Client Secret is required")
    if not body.signing_secret.strip():
        raise HTTPException(status_code=400, detail="Slack Signing Secret is required")

    cfg = SlackBotConfig(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=name,
        client_id=body.client_id.strip(),
        client_secret=body.client_secret.strip(),
        signing_secret=body.signing_secret.strip(),
    )
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return {
        "id": cfg.id,
        "key": f"config:{cfg.id}",
        "name": cfg.name,
        "masked_token": _mask_token(cfg.bot_token),
        "team_id": cfg.team_id,
        "team_name": cfg.team_name,
        "is_env": False,
        "has_token": bool(cfg.bot_token),
        "created_at": cfg.created_at.isoformat() if cfg.created_at else None,
    }


@router.delete("/bot-configs/{config_id}")
async def delete_bot_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cfg = await db.get(SlackBotConfig, config_id)
    if not cfg or cfg.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection config not found")
    await db.delete(cfg)
    await db.commit()
    return {"message": "Connection config removed successfully"}


# ── OAuth2 flow ──────────────────────────────────────────────────────

async def _resolve_config(db: AsyncSession, user_id: str, config_key: str | None) -> dict:
    env_config = _env_bot_option()
    key = (config_key or "").strip()
    if not key or key == "env":
        if env_config:
            return env_config
        raise HTTPException(status_code=400, detail="Default Slack config is not configured on the server.")
    if not key.startswith("config:"):
        raise HTTPException(status_code=400, detail="Invalid Slack config key")
    config_id = key.split(":", 1)[1]
    cfg = await db.get(SlackBotConfig, config_id)
    if not cfg or cfg.user_id != user_id:
        raise HTTPException(status_code=404, detail="Slack config not found")
    return {
        "id": cfg.id,
        "key": f"config:{cfg.id}",
        "name": cfg.name,
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
        "signing_secret": cfg.signing_secret,
        "bot_token": cfg.bot_token,
        "team_id": cfg.team_id,
        "team_name": cfg.team_name,
        "is_env": False,
    }


@router.get("/oauth/start")
async def oauth_start(
    request: Request,
    config_key: str = "env",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Redirect user to Slack OAuth2 authorization page."""
    config = await _resolve_config(db, current_user.id, config_key)
    client_id = config.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Slack Client ID not configured for this config")

    state = secrets.token_hex(32)
    config_id = None if config["is_env"] else config["id"]

    oauth_state = SlackOAuthState(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        state=state,
        config_id=config_id,
        expires_at=datetime.utcnow() + timedelta(minutes=15),
    )
    db.add(oauth_state)
    await db.commit()

    base_url = str(request.base_url).rstrip("/")
    redirect_uri = f"{base_url}/api/slack/oauth/callback"

    slack_url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={client_id}"
        f"&scope={SLACK_OAUTH_SCOPES}"
        f"&state={state}"
        f"&redirect_uri={redirect_uri}"
    )
    return RedirectResponse(url=slack_url)


@router.get("/oauth/callback")
async def oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Handle Slack OAuth2 callback, exchange code for token."""
    if error:
        return HTMLResponse(_oauth_result_html(False, f"Authorization denied: {error}"))
    if not code or not state:
        return HTMLResponse(_oauth_result_html(False, "Missing code or state parameter"))

    result = await db.execute(
        select(SlackOAuthState).where(SlackOAuthState.state == state)
    )
    oauth_state = result.scalar_one_or_none()
    if not oauth_state:
        return HTMLResponse(_oauth_result_html(False, "Invalid or expired OAuth state"))
    if oauth_state.expires_at < datetime.utcnow():
        await db.delete(oauth_state)
        await db.commit()
        return HTMLResponse(_oauth_result_html(False, "OAuth state expired. Please try again."))

    if oauth_state.config_id:
        cfg = await db.get(SlackBotConfig, oauth_state.config_id)
    else:
        cfg = None

    env_config = _env_bot_option()
    if cfg:
        client_id = cfg.client_id
        client_secret = cfg.client_secret
    elif env_config:
        client_id = env_config["client_id"]
        client_secret = env_config["client_secret"]
    else:
        await db.delete(oauth_state)
        await db.commit()
        return HTMLResponse(_oauth_result_html(False, "No Slack configuration found"))

    base_url = str(request.base_url).rstrip("/")
    redirect_uri = f"{base_url}/api/slack/oauth/callback"

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://slack.com/api/oauth.v2.access",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )
            data = resp.json()
        except Exception as e:
            await db.delete(oauth_state)
            await db.commit()
            return HTMLResponse(_oauth_result_html(False, f"Failed to exchange code: {e}"))

    if not data.get("ok"):
        await db.delete(oauth_state)
        await db.commit()
        return HTMLResponse(_oauth_result_html(False, f"Slack error: {data.get('error', 'unknown')}"))

    bot_token = data.get("access_token", "")
    team_info = data.get("team", {})
    team_id = team_info.get("id", "")
    team_name = team_info.get("name", "")

    if cfg:
        cfg.bot_token = bot_token
        cfg.team_id = team_id
        cfg.team_name = team_name
    else:
        cfg = SlackBotConfig(
            id=str(uuid.uuid4()),
            user_id=oauth_state.user_id,
            name=team_name or "Slack Workspace",
            client_id=client_id,
            client_secret=client_secret,
            signing_secret=env_config["signing_secret"] if env_config else "",
            bot_token=bot_token,
            team_id=team_id,
            team_name=team_name,
        )
        db.add(cfg)

    await db.delete(oauth_state)
    await db.commit()

    return HTMLResponse(_oauth_result_html(True, f"Connected to {team_name or 'Slack workspace'}!"))


def _oauth_result_html(success: bool, message: str) -> str:
    status = "success" if success else "error"
    return f"""<!DOCTYPE html>
<html><head><title>Slack Connection</title></head>
<body>
<h2>{"Connected!" if success else "Connection Failed"}</h2>
<p>{message}</p>
<p>You can close this window.</p>
<script>
  if (window.opener) {{
    window.opener.postMessage({{ type: "slack-oauth-{status}" }}, "*");
  }}
  setTimeout(function() {{ window.close(); }}, 2000);
</script>
</body></html>"""


# ── Channel connections ──────────────────────────────────────────────

@router.get("/channels/{agent_id}")
async def list_channels(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    result = await db.execute(
        select(SlackConnection).where(
            SlackConnection.agent_id == agent_id,
            SlackConnection.user_id == current_user.id,
        )
    )
    connections = result.scalars().all()

    config_ids = {c.slack_bot_config_id for c in connections}
    config_result = await db.execute(
        select(SlackBotConfig).where(SlackBotConfig.id.in_(config_ids))
    )
    config_map = {cfg.id: cfg for cfg in config_result.scalars().all()}

    return {
        "connections": [
            {
                "id": c.id,
                "channel_id": c.channel_id,
                "channel_name": c.channel_name,
                "team_id": c.team_id,
                "config_name": config_map[c.slack_bot_config_id].name
                if c.slack_bot_config_id in config_map
                else None,
                "created_at": c.created_at.isoformat(),
            }
            for c in connections
        ]
    }


@router.post("/channels/{agent_id}")
async def connect_channel(
    agent_id: str,
    body: SlackChannelConnect,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = await db.get(Agent, agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = await _resolve_config(db, current_user.id, body.config_key)
    if not config.get("bot_token"):
        raise HTTPException(
            status_code=400,
            detail="This Slack config has no bot token yet. Complete the OAuth flow first.",
        )

    channel_id = body.channel_id.strip()
    if not channel_id:
        raise HTTPException(status_code=400, detail="Channel ID is required")

    existing = await db.execute(
        select(SlackConnection).where(SlackConnection.channel_id == channel_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This channel is already connected")

    channel_name = await _fetch_channel_name(config["bot_token"], channel_id)

    conn = SlackConnection(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        agent_id=agent_id,
        slack_bot_config_id=config["id"] if not config["is_env"] else "env",
        team_id=config.get("team_id"),
        channel_id=channel_id,
        channel_name=channel_name,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    return {
        "id": conn.id,
        "channel_id": conn.channel_id,
        "channel_name": conn.channel_name,
        "team_id": conn.team_id,
        "created_at": conn.created_at.isoformat(),
    }


@router.delete("/channels/{connection_id}")
async def remove_channel(
    connection_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conn = await db.get(SlackConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    await db.delete(conn)
    await db.commit()
    return {"message": "Connection removed successfully"}


async def _fetch_channel_name(token: str, channel_id: str) -> str | None:
    """Try to fetch channel name from Slack API."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://slack.com/api/conversations.info",
                params={"channel": channel_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            data = resp.json()
            if data.get("ok"):
                return data["channel"].get("name")
        except Exception:
            pass
    return None


# ── Slack Events API webhook ─────────────────────────────────────────

@router.post("/events")
async def slack_events(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle incoming Slack Events API requests (public endpoint)."""
    body = await request.body()
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    if payload.get("type") == "url_verification":
        return JSONResponse({"challenge": payload.get("challenge", "")})

    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")
    team_id = payload.get("team_id")

    config = await _find_config_for_team(db, team_id)
    if not config:
        raise HTTPException(status_code=404, detail="No Slack config found for this team")

    signing_secret = config.get("signing_secret", "")
    if signing_secret and not verify_slack_signature(signing_secret, timestamp, body, signature):
        raise HTTPException(status_code=403, detail="Invalid Slack signature")

    if payload.get("type") == "event_callback":
        await handle_event_callback(payload, db)

    return JSONResponse({"ok": True})


@router.post("/commands")
async def slack_commands(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle incoming Slack slash commands (public endpoint)."""
    body = await request.body()
    form = await request.form()

    team_id = form.get("team_id", "")
    channel_id = form.get("channel_id", "")
    text = form.get("text", "")

    config = await _find_config_for_team(db, str(team_id))
    if not config:
        return JSONResponse({"response_type": "ephemeral", "text": "No Slack config found for this workspace."})

    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")
    signing_secret = config.get("signing_secret", "")
    if signing_secret and not verify_slack_signature(signing_secret, timestamp, body, signature):
        return JSONResponse({"response_type": "ephemeral", "text": "Invalid request signature."})

    answer = await handle_slash_command(str(channel_id), str(text), str(team_id), db)
    return JSONResponse({"response_type": "in_channel", "text": answer})


async def _find_config_for_team(db: AsyncSession, team_id: str | None) -> dict | None:
    """Find a Slack config by team_id (DB configs first, then env)."""
    if team_id:
        result = await db.execute(
            select(SlackBotConfig).where(SlackBotConfig.team_id == team_id)
        )
        cfg = result.scalars().first()
        if cfg:
            return {
                "id": cfg.id,
                "bot_token": cfg.bot_token,
                "signing_secret": cfg.signing_secret,
                "team_id": cfg.team_id,
                "is_env": False,
            }
    env = _env_bot_option()
    if env:
        return {
            "id": "env",
            "bot_token": env["bot_token"],
            "signing_secret": env["signing_secret"],
            "team_id": None,
            "is_env": True,
        }
    return None
