"""Add platform_logs table for LLM activity persistence.

Revision ID: 20250216100000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250216100000"
down_revision: Union[str, None] = "20250216000000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "platform_logs" not in inspector.get_table_names():
        op.create_table(
            "platform_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("action", sa.String(50), nullable=False),
            sa.Column("provider", sa.String(50), nullable=False),
            sa.Column("model", sa.String(128), nullable=False),
            sa.Column("input_tokens", sa.Integer(), server_default=sa.text("0")),
            sa.Column("output_tokens", sa.Integer(), server_default=sa.text("0")),
            sa.Column("context", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.create_index("ix_platform_logs_created_at", "platform_logs", ["created_at"], unique=False)
        op.create_index("ix_platform_logs_action", "platform_logs", ["action"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_platform_logs_action", table_name="platform_logs")
    op.drop_index("ix_platform_logs_created_at", table_name="platform_logs")
    op.drop_table("platform_logs")
