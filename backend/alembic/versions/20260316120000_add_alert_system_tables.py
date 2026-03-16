"""Add alert_executions, webhooks tables and new columns to alerts.

Revision ID: 20260316120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260316120000"
down_revision: Union[str, Sequence[str], None] = "20260313120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # -- New columns on alerts table --
    if "alerts" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("alerts")}
        if "type" not in existing:
            op.add_column("alerts", sa.Column("type", sa.String(50), server_default="alert"))
        if "is_active" not in existing:
            op.add_column("alerts", sa.Column("is_active", sa.Boolean(), server_default=sa.text("1")))
        if "last_run" not in existing:
            op.add_column("alerts", sa.Column("last_run", sa.DateTime(), nullable=True))
        if "last_status" not in existing:
            op.add_column("alerts", sa.Column("last_status", sa.String(50), nullable=True))

    # -- alert_executions table --
    if "alert_executions" not in inspector.get_table_names():
        op.create_table(
            "alert_executions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("alert_id", sa.String(36), sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("status", sa.String(50), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("email_sent", sa.Boolean(), server_default=sa.text("0")),
            sa.Column("webhooks_fired", sa.Integer(), server_default=sa.text("0")),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        )

    # -- webhooks table --
    if "webhooks" not in inspector.get_table_names():
        op.create_table(
            "webhooks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("url", sa.String(1024), nullable=False),
            sa.Column("secret", sa.String(512), nullable=True),
            sa.Column("events", sa.JSON(), nullable=True),
            sa.Column("headers", sa.JSON(), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("1")),
            sa.Column("last_triggered_at", sa.DateTime(), nullable=True),
            sa.Column("last_status_code", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("webhooks")
    op.drop_table("alert_executions")

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "alerts" in inspector.get_table_names():
        existing = {c["name"] for c in inspector.get_columns("alerts")}
        for col in ("type", "is_active", "last_run", "last_status"):
            if col in existing:
                op.drop_column("alerts", col)
