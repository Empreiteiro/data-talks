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


# ---------------------------------------------------------------------------
# Envelope encryption for JSON dicts and specific model fields
#
# Sources store credentials inside a free-form JSON `metadata_` column. Rather
# than adding a dedicated encrypted column per source type, we wrap known
# secret keys in an `{"__enc": "<fernet>"}` envelope. Reads transparently
# unwrap. Anything not matching the envelope is returned as-is.
#
# Bot tokens (Telegram, WhatsApp, Slack) are scalar strings. The same Fernet
# ciphertext format is applied with a magic-prefix sniff (`gAAAA`) so we can
# tell encrypted from plaintext and avoid double-encryption on re-save.
# ---------------------------------------------------------------------------

# Known secret-carrying keys in Source.metadata_. Lowercase comparison.
SOURCE_SECRET_KEYS: frozenset[str] = frozenset({
    "password",
    "connection_string",
    "service_account_json",
    "service_account_key",
    "api_key",
    "auth_token",
    "bearer_token",
    "access_token",
    "secret_access_key",
    "aws_secret_access_key",
    "private_key",
    "client_secret",
})

# Fernet ciphertext tokens start with "gAAAA" (version byte 0x80 + base64url).
_FERNET_PREFIX = "gAAAA"


def looks_encrypted(value: str) -> bool:
    """Quick sniff: does this look like a Fernet token?"""
    return isinstance(value, str) and value.startswith(_FERNET_PREFIX)


def encrypt_scalar(value: str | None) -> str | None:
    """Encrypt a scalar secret. No-op on None/empty/already-ciphertext."""
    if value is None or value == "":
        return value
    if looks_encrypted(value):
        return value
    return encrypt_text(value)


def decrypt_scalar(value: str | None) -> str | None:
    """Return the plaintext for a scalar secret. No-op on None/empty.

    If the value doesn't look like ciphertext we assume it is legacy
    plaintext that hasn't been migrated yet and return it unchanged.
    """
    if value is None or value == "":
        return value
    if not looks_encrypted(value):
        return value
    return decrypt_text(value)


def encrypt_secret_fields(obj: dict | None, secret_keys: frozenset[str] | set[str] | None = None) -> dict | None:
    """Return a copy of `obj` with every value under a matching key wrapped
    in `{"__enc": "<fernet>"}`. Nested dicts are recursed; lists are walked.

    Already-wrapped envelopes and non-string values are left alone.
    """
    if obj is None:
        return None
    keys = secret_keys if secret_keys is not None else SOURCE_SECRET_KEYS

    def _walk(node):
        if isinstance(node, dict):
            out: dict = {}
            for k, v in node.items():
                if isinstance(k, str) and k.lower() in keys:
                    out[k] = _wrap(v)
                else:
                    out[k] = _walk(v)
            return out
        if isinstance(node, list):
            return [_walk(v) for v in node]
        return node

    def _wrap(v):
        if v is None or v == "":
            return v
        if isinstance(v, dict) and "__enc" in v:
            return v  # already wrapped
        if not isinstance(v, str):
            # Don't try to encrypt non-strings (ints, bools). Upstream
            # callers shouldn't put those under secret keys anyway.
            return v
        return {"__enc": encrypt_text(v)}

    return _walk(obj)


def decrypt_secret_fields(obj: dict | None) -> dict | None:
    """Return a copy of `obj` with every `{"__enc": "<cipher>"}` envelope
    replaced by the plaintext. Structure is otherwise preserved.
    """
    if obj is None:
        return None

    def _walk(node):
        if isinstance(node, dict):
            if "__enc" in node and len(node) == 1 and isinstance(node["__enc"], str):
                return decrypt_text(node["__enc"])
            return {k: _walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_walk(v) for v in node]
        return node

    return _walk(obj)


class EncryptedText:
    """SQLAlchemy TypeDecorator for transparently-encrypted string columns.

    Imported on demand by `app.models` — living here keeps crypto.py as
    the single place that knows about Fernet.

    Existing rows with plaintext values keep working: we detect ciphertext
    via the `gAAAA` Fernet prefix and only decrypt then, so migrations can
    ship this type before or after a data migration that re-encrypts
    existing rows.
    """

    # Lazy-built once the module is first accessed, so test environments
    # that override SECRET_KEY before importing models see the right key.
    _built = None

    def __new__(cls):  # pragma: no cover — factory
        if cls._built is None:
            from sqlalchemy.types import Text as _Text, TypeDecorator

            class _EncryptedText(TypeDecorator):
                impl = _Text
                cache_ok = True

                def process_bind_param(self, value, dialect):
                    if value is None:
                        return None
                    if not isinstance(value, str):
                        value = str(value)
                    if looks_encrypted(value):
                        return value
                    return encrypt_text(value)

                def process_result_value(self, value, dialect):
                    if value is None or value == "":
                        return value
                    if not looks_encrypted(value):
                        return value  # legacy plaintext from before migration
                    try:
                        return decrypt_text(value)
                    except RuntimeError:
                        return value  # surface rather than 500; operator will see and re-key

            cls._built = _EncryptedText
        return cls._built()


def unlock_source_metadata(source) -> None:
    """In-place decrypt of `source.metadata_` so downstream scripts see
    plaintext values. Safe to call multiple times — decrypt is idempotent
    on plaintext and envelope format."""
    if source is None:
        return
    meta = getattr(source, "metadata_", None)
    if not meta:
        return
    source.metadata_ = decrypt_secret_fields(meta)


def mask_secret_fields(obj: dict | None, secret_keys: frozenset[str] | set[str] | None = None) -> dict | None:
    """Return a copy of `obj` where every secret value is replaced by
    `{"present": true}` (if set) or `None`. For use in list/get API
    responses so we never echo a plaintext credential back to the client.
    """
    if obj is None:
        return None
    keys = secret_keys if secret_keys is not None else SOURCE_SECRET_KEYS

    def _walk(node):
        if isinstance(node, dict):
            out: dict = {}
            for k, v in node.items():
                if isinstance(k, str) and k.lower() in keys:
                    if v is None or v == "":
                        out[k] = None
                    else:
                        out[k] = {"present": True}
                else:
                    out[k] = _walk(v)
            return out
        if isinstance(node, list):
            return [_walk(v) for v in node]
        return node

    return _walk(obj)
