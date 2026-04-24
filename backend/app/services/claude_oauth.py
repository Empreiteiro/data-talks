"""Claude Code OAuth (PKCE) — login with the user's claude.ai account.

Mimics the public Claude Code CLI client_id to obtain a user-scoped access
token bearing the `user:inference` scope, which lets the platform call the
Anthropic Messages API on the user's behalf using their Claude Max
subscription. There is no client secret — PKCE is the only anti-interception
mechanism — and Anthropic does not officially document this flow, so callers
must accept that the upstream constants below can change without notice.

Why we mirror this flow rather than ask the user for an API key:
- API keys imply Anthropic billing tied to the operator's account; OAuth
  binds the inference cost to the end user's subscription.
- The Claude Code CLI itself is a public client and uses these exact
  constants; we are not bypassing any auth wall, only impersonating an
  already-public client_id with the user's explicit consent at claude.ai.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Upstream constants (Claude Code CLI public client)
# ---------------------------------------------------------------------------
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
SCOPES = "org:create_api_key user:profile user:inference"

# How long a generated state/verifier pair is good for. The user has to
# authorize on claude.ai and paste the code back within this window.
_STATE_TTL_SECONDS = 600

# In-memory store of pending PKCE flows keyed by `state`. Same pattern used by
# `app/routers/github_integration_router.py:_pending_states`. Single-process /
# single-worker only; for multi-worker deployments this should be Redis or a
# dedicated DB table.
_PENDING: dict[str, tuple[str, datetime]] = {}


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _b64url(data: bytes) -> str:
    """RFC 7636 url-safe base64 *without* trailing `=` padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def make_pkce() -> tuple[str, str]:
    """Return `(verifier, challenge)`. Verifier stays on the server; challenge
    is sent to the authorize URL and ties the eventual code back to us."""
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def build_auth_url(challenge: str, state: str) -> str:
    """Authorize URL the user opens in their browser. Carries `code=true` so
    Anthropic shows the OOB code page (rather than redirecting somewhere)."""
    params = {
        "code": "true",
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# ---------------------------------------------------------------------------
# Pending-state cache
# ---------------------------------------------------------------------------

def _prune_expired_states() -> None:
    now = datetime.utcnow()
    expired = [k for k, (_v, exp) in _PENDING.items() if now > exp]
    for k in expired:
        _PENDING.pop(k, None)


def remember(state: str, verifier: str) -> None:
    """Store `verifier` keyed by `state` until either `consume` is called or
    the TTL expires."""
    _prune_expired_states()
    _PENDING[state] = (verifier, datetime.utcnow() + timedelta(seconds=_STATE_TTL_SECONDS))


def consume(state: str) -> str | None:
    """Pop and return the verifier for `state`, or `None` if the state is
    unknown or has expired. One-time use — repeated calls return None."""
    _prune_expired_states()
    pair = _PENDING.pop(state, None)
    if not pair:
        return None
    verifier, expires_at = pair
    if datetime.utcnow() > expires_at:
        return None
    return verifier


# ---------------------------------------------------------------------------
# Code exchange
# ---------------------------------------------------------------------------

class ClaudeOAuthError(RuntimeError):
    """Raised when Anthropic refuses the code or returns malformed data.
    Routers translate this into a 502 with the message intact."""


async def exchange_code(code: str, state: str, verifier: str) -> dict:
    """Trade the OOB authorization code for an access token.

    Anthropic's OOB callback shows the code as `<authcode>#<state>`; users
    typically copy the entire string. We split on `#` defensively so both
    formats work.

    Returns the parsed JSON response — typically
    `{access_token, token_type, expires_in, refresh_token?, scope}`. Raises
    `ClaudeOAuthError` on any non-2xx, surfacing the upstream response body
    so the user gets an actionable hint.
    """
    raw_code = (code or "").strip()
    if not raw_code:
        raise ClaudeOAuthError("Authorization code is empty")
    # Accept "<authcode>#<state>" — strip the suffix if present
    if "#" in raw_code:
        raw_code = raw_code.split("#", 1)[0]

    payload = {
        "grant_type": "authorization_code",
        "code": raw_code,
        "state": state,
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                TOKEN_URL,
                json=payload,
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as e:
        raise ClaudeOAuthError(f"Network error talking to Anthropic: {e}") from e

    if r.status_code >= 400:
        body = r.text or ""
        # Trim noisy HTML responses to keep the API surface clean.
        snippet = body.strip()[:600]
        raise ClaudeOAuthError(
            f"Anthropic rejected the code ({r.status_code}): {snippet}"
        )

    try:
        data = r.json()
    except ValueError as e:
        raise ClaudeOAuthError("Anthropic returned a non-JSON response") from e

    if not isinstance(data, dict) or not data.get("access_token"):
        raise ClaudeOAuthError(
            f"Token response missing `access_token`: {str(data)[:300]}"
        )
    return data
