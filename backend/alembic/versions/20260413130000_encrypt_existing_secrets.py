"""Encrypt existing plaintext secrets in place.

Walks every row that may carry credentials and rewraps the secret values:

- `sources.metadata_`: keys matching SOURCE_SECRET_KEYS get wrapped in
  `{"__enc": "<fernet>"}` envelopes.
- `telegram_bot_configs.bot_token`, `whatsapp_bot_configs.(access_token,
  verify_token)`, `slack_bot_configs.(client_secret, signing_secret,
  bot_token)`: encrypted in-place.

Idempotent: values that already look like ciphertext (Fernet `gAAAA`
prefix) or an `{"__enc": "..."}` envelope are skipped.

Revision ID: 20260413130000
"""
from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260413130000"
down_revision: Union[str, None] = "20260413120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Duplicated from app.services.crypto to keep the migration self-contained.
# If that set ever expands, this migration stays a snapshot of the old set —
# a follow-up migration can re-encrypt anything newly classified as secret.
SOURCE_SECRET_KEYS = frozenset({
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
_FERNET_PREFIX = "gAAAA"


def _looks_encrypted(v) -> bool:
    return isinstance(v, str) and v.startswith(_FERNET_PREFIX)


def _wrap_scalar(encrypt, value):
    if value is None or value == "":
        return value
    if isinstance(value, str) and _looks_encrypted(value):
        return value
    if isinstance(value, dict) and "__enc" in value:
        return value
    return {"__enc": encrypt(value if isinstance(value, str) else str(value))}


def _walk_meta(encrypt, node):
    """Return a deep copy of `node` with SOURCE_SECRET_KEYS values wrapped."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if isinstance(k, str) and k.lower() in SOURCE_SECRET_KEYS:
                out[k] = _wrap_scalar(encrypt, v)
            else:
                out[k] = _walk_meta(encrypt, v)
        return out
    if isinstance(node, list):
        return [_walk_meta(encrypt, v) for v in node]
    return node


def _load_encrypt_callable():
    """Import `encrypt_text` from the app at runtime. We can't import
    eagerly at the top of this file because Alembic loads migrations
    before the app package is necessarily importable in some setups."""
    from app.services.crypto import encrypt_text
    return encrypt_text


def upgrade() -> None:
    conn = op.get_bind()
    encrypt_text = _load_encrypt_callable()

    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # --- sources.metadata_ ---------------------------------------------------
    if "sources" in tables:
        rows = conn.execute(sa.text("SELECT id, metadata FROM sources")).fetchall()
        for row in rows:
            source_id = row[0]
            raw = row[1]
            if raw is None:
                continue
            # SQLite returns JSON columns as strings; Postgres returns dicts.
            if isinstance(raw, str):
                try:
                    meta = json.loads(raw)
                except (TypeError, ValueError):
                    continue
            else:
                meta = raw
            if not isinstance(meta, dict):
                continue
            rewrapped = _walk_meta(encrypt_text, meta)
            if rewrapped != meta:
                conn.execute(
                    sa.text("UPDATE sources SET metadata = :m WHERE id = :id"),
                    {"m": json.dumps(rewrapped), "id": source_id},
                )

    # --- scalar token tables -------------------------------------------------
    scalar_targets = [
        ("telegram_bot_configs", ["bot_token"]),
        ("whatsapp_bot_configs", ["access_token", "verify_token"]),
        ("slack_bot_configs", ["client_secret", "signing_secret", "bot_token"]),
    ]

    for table, cols in scalar_targets:
        if table not in tables:
            continue
        col_names = {c["name"] for c in inspector.get_columns(table)}
        existing_cols = [c for c in cols if c in col_names]
        if not existing_cols:
            continue
        select_sql = f"SELECT id, {', '.join(existing_cols)} FROM {table}"
        rows = conn.execute(sa.text(select_sql)).fetchall()
        for row in rows:
            row_id = row[0]
            updates: dict[str, str] = {}
            for i, col in enumerate(existing_cols, start=1):
                value = row[i]
                if value is None or value == "":
                    continue
                if _looks_encrypted(value):
                    continue
                updates[col] = encrypt_text(value)
            if updates:
                set_clause = ", ".join(f"{c} = :{c}" for c in updates)
                params = {**updates, "id": row_id}
                conn.execute(
                    sa.text(f"UPDATE {table} SET {set_clause} WHERE id = :id"),
                    params,
                )


def downgrade() -> None:
    # Decryption downgrade is not provided: plaintext cannot be recovered
    # without the Fernet key. Operators who need to roll back should restore
    # from backup.
    pass
