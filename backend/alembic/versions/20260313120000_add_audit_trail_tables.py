"""Add audit_logs and audit_retention_config tables.

Revision ID: 20260313120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260313120000"
down_revision: Union[str, Sequence[str], None] = "20260311120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "audit_logs" not in inspector.get_table_names():
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=True, index=True),
            sa.Column("user_email", sa.String(255), nullable=True),
            sa.Column("action", sa.String(100), nullable=False, index=True),
            sa.Column("category", sa.String(50), nullable=False, index=True),
            sa.Column("resource_type", sa.String(50), nullable=True),
            sa.Column("resource_id", sa.String(36), nullable=True),
            sa.Column("detail", sa.Text, nullable=True),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.String(512), nullable=True),
            sa.Column("metadata", sa.JSON, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now(), index=True),
        )

    if "audit_retention_config" not in inspector.get_table_names():
        op.create_table(
            "audit_retention_config",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("retention_days", sa.Integer, nullable=False, server_default="90"),
            sa.Column("updated_by", sa.String(36), nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("audit_retention_config")
    op.drop_table("audit_logs")
