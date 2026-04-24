"""Encrypt existing plaintext Claude Code OAuth tokens.

Idempotent data migration. Walks `llm_configs` and `llm_settings` and
Fernet-wraps any non-empty `claude_code_oauth_token` whose value doesn't
already look like Fernet ciphertext (`gAAAA` prefix). Re-running the
migration is a no-op.

Revision ID: 20260424120000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260424120000"
down_revision: Union[str, None] = "20260414120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_FERNET_PREFIX = "gAAAA"


def _looks_encrypted(v) -> bool:
    return isinstance(v, str) and v.startswith(_FERNET_PREFIX)


def upgrade() -> None:
    """Walk both tables and encrypt any plaintext OAuth tokens in place."""
    from app.services.crypto import encrypt_text

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    for table in ("llm_configs", "llm_settings"):
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if "claude_code_oauth_token" not in cols:
            continue
        # Different PK shapes: llm_configs uses `id`, llm_settings uses `user_id`.
        pk = "id" if "id" in cols else "user_id"
        rows = conn.execute(
            sa.text(f"SELECT {pk}, claude_code_oauth_token FROM {table}")
        ).fetchall()
        for row in rows:
            row_id = row[0]
            value = row[1]
            if value is None or value == "":
                continue
            if _looks_encrypted(value):
                continue
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET claude_code_oauth_token = :v WHERE {pk} = :id"
                ),
                {"v": encrypt_text(value), "id": row_id},
            )


def downgrade() -> None:
    # Plaintext cannot be recovered without the Fernet key; restore from
    # backup if you need to roll back. Same approach as the prior secret
    # encryption migration (20260413130000).
    pass
