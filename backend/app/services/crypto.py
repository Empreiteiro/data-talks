"""Symmetric encryption for at-rest secrets (GitHub OAuth tokens, etc.).

Uses Fernet (AES-128-CBC + HMAC-SHA256). The Fernet key comes from
`GITHUB_TOKEN_ENCRYPTION_KEY` when set (url-safe base64 of 32 random bytes), or is
derived from `SECRET_KEY` via HKDF-SHA256 so deployments get encryption-at-rest
for free as long as they set a strong SECRET_KEY.
"""
from __future__ import annotations

import base64
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings


_HKDF_SALT = b"data-talks:v1"
_HKDF_INFO = b"data-talks/github-oauth/fernet-key"


def _derive_key_from_secret(secret: str) -> bytes:
    """Derive a 32-byte Fernet key from the app SECRET_KEY via HKDF-SHA256."""
    if not secret:
        raise RuntimeError(
            "SECRET_KEY is empty; cannot derive encryption key. "
            "Set SECRET_KEY or GITHUB_TOKEN_ENCRYPTION_KEY in backend/.env."
        )
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    )
    raw = hkdf.derive(secret.encode("utf-8"))
    return base64.urlsafe_b64encode(raw)


@lru_cache
def get_fernet() -> Fernet:
    """Return a singleton Fernet instance keyed from settings."""
    settings = get_settings()
    explicit = (settings.github_token_encryption_key or "").strip()
    if explicit:
        key = explicit.encode("utf-8")
    else:
        key = _derive_key_from_secret(settings.secret_key)
    return Fernet(key)


def encrypt_text(plain: str) -> str:
    """Encrypt a string and return a url-safe string suitable for DB storage."""
    if plain is None:
        raise ValueError("Cannot encrypt None")
    token = get_fernet().encrypt(plain.encode("utf-8"))
    return token.decode("ascii")


def decrypt_text(cipher: str) -> str:
    """Decrypt a previously-encrypted string."""
    if not cipher:
        return ""
    try:
        return get_fernet().decrypt(cipher.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise RuntimeError(
            "Failed to decrypt stored token. The encryption key has likely changed."
        ) from e
