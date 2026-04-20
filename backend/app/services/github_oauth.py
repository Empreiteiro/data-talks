"""GitHub OAuth 2.0 flow and REST helpers for pushing pipeline versions.

Stateless with respect to GitHub: no git clone. All writes use the Contents
API (`PUT /repos/{owner}/{repo}/contents/{path}`). Tokens are encrypted at
rest via `app.services.crypto`.
"""
from __future__ import annotations

import base64
import json
from urllib.parse import urlencode

import httpx

from app.config import get_settings


GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_BASE = "https://api.github.com"
GITHUB_SCOPES = "repo"  # needed for private repos + writes; user can still pick public repos
DEFAULT_TIMEOUT = 15.0


class GitHubOAuthNotConfigured(RuntimeError):
    """Raised when GITHUB_OAUTH_CLIENT_ID/SECRET are not set."""


def _require_config() -> tuple[str, str, str]:
    settings = get_settings()
    cid = (settings.github_oauth_client_id or "").strip()
    secret = (settings.github_oauth_client_secret or "").strip()
    if not cid or not secret:
        raise GitHubOAuthNotConfigured(
            "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and "
            "GITHUB_OAUTH_CLIENT_SECRET in backend/.env."
        )
    redirect = (settings.github_oauth_redirect_uri or "").strip()
    if not redirect:
        redirect = f"{settings.app_url.rstrip('/')}/api/integrations/github/callback"
    return cid, secret, redirect


def build_authorize_url(state: str) -> str:
    """Build the GitHub authorize URL with CSRF state."""
    cid, _secret, redirect = _require_config()
    params = {
        "client_id": cid,
        "redirect_uri": redirect,
        "scope": GITHUB_SCOPES,
        "state": state,
        "allow_signup": "false",
    }
    return f"{GITHUB_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange an authorization code for an access token."""
    cid, secret, redirect = _require_config()
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": cid,
                "client_secret": secret,
                "code": code,
                "redirect_uri": redirect,
            },
        )
        r.raise_for_status()
        data = r.json()
        if data.get("error"):
            raise RuntimeError(f"GitHub token exchange failed: {data.get('error_description') or data.get('error')}")
        return data


async def get_user_profile(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(
            f"{GITHUB_API_BASE}/user",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        r.raise_for_status()
        return r.json()


async def list_writable_repos(access_token: str, limit: int = 100) -> list[dict]:
    """Return repos the token owner can push to (owner or collaborator)."""
    results: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        while len(results) < limit and page <= 5:
            r = await client.get(
                f"{GITHUB_API_BASE}/user/repos",
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {access_token}",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                params={
                    "affiliation": "owner,collaborator,organization_member",
                    "per_page": min(100, limit - len(results)),
                    "page": page,
                    "sort": "updated",
                },
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            for repo in batch:
                perms = repo.get("permissions") or {}
                if not (perms.get("push") or perms.get("admin")):
                    continue
                results.append(
                    {
                        "full_name": repo.get("full_name"),
                        "private": repo.get("private"),
                        "default_branch": repo.get("default_branch"),
                        "description": repo.get("description"),
                        "updated_at": repo.get("updated_at"),
                    }
                )
            page += 1
    return results


async def _get_file_sha(
    access_token: str, *, repo_full_name: str, branch: str, path: str
) -> str | None:
    """Look up the current SHA of a file so `put_file` can update in place."""
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(
            f"{GITHUB_API_BASE}/repos/{repo_full_name}/contents/{path}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            params={"ref": branch},
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        return data.get("sha")


async def put_file(
    access_token: str,
    *,
    repo_full_name: str,
    branch: str,
    path: str,
    content: bytes,
    message: str,
) -> dict:
    """Create or update a file via the Contents API. Returns commit info."""
    sha = await _get_file_sha(
        access_token, repo_full_name=repo_full_name, branch=branch, path=path
    )
    payload: dict = {
        "message": message,
        "content": base64.b64encode(content).decode("ascii"),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.put(
            f"{GITHUB_API_BASE}/repos/{repo_full_name}/contents/{path}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            content=json.dumps(payload),
        )
        r.raise_for_status()
        return r.json()
