"""Add claude-code provider columns to llm_configs and llm_settings.

Revision ID: 20260407130000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260407130000"
down_revision: Union[str, None] = "20260407120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    for table in ("llm_configs", "llm_settings"):
        if inspector.has_table(table):
            existing = {c["name"] for c in inspector.get_columns(table)}
            if "claude_code_model" not in existing:
                op.add_column(table, sa.Column("claude_code_model", sa.String(64), nullable=True))
            if "claude_code_oauth_token" not in existing:
                op.add_column(table, sa.Column("claude_code_oauth_token", sa.String(512), nullable=True))


def downgrade() -> None:
    for table in ("llm_configs", "llm_settings"):
        op.drop_column(table, "claude_code_oauth_token")
        op.drop_column(table, "claude_code_model")
