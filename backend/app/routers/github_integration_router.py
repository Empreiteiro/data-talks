"""GitHub OAuth integration: connect, select repo, push pipeline versions.

Flow:
1. Frontend calls GET /authorize → backend returns {url, state}. State is
   bound to the authenticated user for 10 minutes in an in-memory cache.
2. Frontend navigates the user to `url`. GitHub redirects to /callback with
   ?code=&state=.
3. /callback validates state, exchanges code, persists encrypted token and
   profile info, then redirects to `{app_url}/settings/integrations?github=connected`.
4. Frontend lists writable repos via /repos and saves the selection via /select-repo.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership
from app.config import get_settings
from app.database import get_db
from app.models import GithubConnection, User
from app.services.crypto import decrypt_text, encrypt_text
from app.services.github_oauth import (
    GitHubOAuthNotConfigured,
    build_authorize_url,
    exchange_code,
    get_user_profile,
    list_writable_repos,
)


router = APIRouter(prefix="/integrations/github", tags=["github-integration"])


# In-memory {state -> (user_id, expires_at)}. Per-process; acceptable for a
# single-worker dev/small-deployment setup. Scaling to multiple workers would
# move this to Redis or a dedicated table.
_OAUTH_STATE_TTL_SECONDS = 600
# state → (user_id, organization_id, expires_at)
_pending_states: dict[str, tuple[str, str, datetime]] = {}


def _remember_state(user_id: str, organization_id: str) -> str:
    _prune_expired_states()
    state = secrets.token_urlsafe(32)
    _pending_states[state] = (
        user_id,
        organization_id,
        datetime.utcnow() + timedelta(seconds=_OAUTH_STATE_TTL_SECONDS),
    )
    return state


def _consume_state(state: str) -> tuple[str, str] | None:
    _prune_expired_states()
    entry = _pending_states.pop(state, None)
    if not entry:
        return None
    user_id, organization_id, expires_at = entry
    if datetime.utcnow() > expires_at:
        return None
    return user_id, organization_id


def _prune_expired_states() -> None:
    now = datetime.utcnow()
    expired = [k for k, (_u, _o, exp) in _pending_states.items() if now > exp]
    for k in expired:
        _pending_states.pop(k, None)


def _connection_to_dict(conn: GithubConnection | None) -> dict:
    if conn is None:
        return {"connected": False}
    return {
        "connected": True,
        "github_login": conn.github_login,
        "github_user_id": conn.github_user_id,
        "selected_repo_full_name": conn.selected_repo_full_name,
        "selected_branch": conn.selected_branch,
        "selected_base_path": conn.selected_base_path,
        "updated_at": conn.updated_at.isoformat() if conn.updated_at else None,
    }


@router.get("/status")
async def status(
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> dict:
    r = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == scope.user.id, GithubConnection.organization_id == scope.organization_id)
    )
    return _connection_to_dict(r.scalar_one_or_none())


@router.get("/authorize")
async def authorize(
    scope: TenantScope = Depends(require_membership),
) -> dict:
    try:
        state = _remember_state(scope.user.id, scope.organization_id)
        url = build_authorize_url(state)
    except GitHubOAuthNotConfigured as e:
        raise HTTPException(500, str(e))
    return {"url": url, "state": state}


@router.get("/callback")
async def callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    state_pair = _consume_state(state)
    if not state_pair:
        raise HTTPException(400, "Invalid or expired OAuth state")
    user_id, organization_id = state_pair

    try:
        token_payload = await exchange_code(code)
    except GitHubOAuthNotConfigured as e:
        raise HTTPException(500, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"GitHub token exchange failed: {e}")

    access_token = token_payload.get("access_token")
    if not access_token:
        raise HTTPException(502, "GitHub did not return an access token")

    try:
        profile = await get_user_profile(access_token)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Failed to fetch GitHub profile: {e}")

    r = await db.execute(
        select(GithubConnection).where(
            GithubConnection.user_id == user_id,
            GithubConnection.organization_id == organization_id,
        )
    )
    conn = r.scalar_one_or_none()
    if conn is None:
        conn = GithubConnection(
            user_id=user_id,
            organization_id=organization_id,
            access_token_enc=encrypt_text(access_token),
        )
        db.add(conn)
    else:
        conn.access_token_enc = encrypt_text(access_token)

    refresh = token_payload.get("refresh_token")
    conn.refresh_token_enc = encrypt_text(refresh) if refresh else None
    expires_in = token_payload.get("expires_in")
    conn.token_expires_at = (
        datetime.utcnow() + timedelta(seconds=int(expires_in)) if expires_in else None
    )
    conn.scopes = token_payload.get("scope") or None
    conn.github_user_id = profile.get("id")
    conn.github_login = profile.get("login")
    await db.commit()

    settings = get_settings()
    target = f"{settings.app_url.rstrip('/')}/settings/integrations?github=connected"
    return RedirectResponse(url=target, status_code=302)


@router.post("/disconnect")
async def disconnect(
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> dict:
    r = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == scope.user.id, GithubConnection.organization_id == scope.organization_id)
    )
    conn = r.scalar_one_or_none()
    if conn:
        await db.delete(conn)
        await db.commit()
    return {"connected": False}


@router.get("/repos")
async def repos(
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> list[dict]:
    r = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == scope.user.id, GithubConnection.organization_id == scope.organization_id)
    )
    conn = r.scalar_one_or_none()
    if not conn:
        raise HTTPException(400, "GitHub not connected")
    try:
        token = decrypt_text(conn.access_token_enc)
    except RuntimeError as e:
        raise HTTPException(500, f"Failed to read GitHub token: {e}")
    try:
        return await list_writable_repos(token, limit=limit)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Failed to list GitHub repositories: {e}")


class SelectRepoRequest(BaseModel):
    repo_full_name: str
    branch: str = "main"
    base_path: str = "data-talks/pipelines"


@router.post("/select-repo")
async def select_repo(
    body: SelectRepoRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
) -> dict:
    r = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == scope.user.id, GithubConnection.organization_id == scope.organization_id)
    )
    conn = r.scalar_one_or_none()
    if not conn:
        raise HTTPException(400, "GitHub not connected")

    # Re-verify that the repo is in the user's writable list at selection time.
    try:
        token = decrypt_text(conn.access_token_enc)
    except RuntimeError as e:
        raise HTTPException(500, f"Failed to read GitHub token: {e}")
    try:
        repos_list = await list_writable_repos(token, limit=200)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Failed to list GitHub repositories: {e}")
    if body.repo_full_name not in {r["full_name"] for r in repos_list}:
        raise HTTPException(
            403,
            f"You do not have push access to {body.repo_full_name}.",
        )

    conn.selected_repo_full_name = body.repo_full_name
    conn.selected_branch = (body.branch or "main").strip() or "main"
    conn.selected_base_path = (body.base_path or "data-talks/pipelines").strip().strip("/")
    await db.commit()
    return _connection_to_dict(conn)
