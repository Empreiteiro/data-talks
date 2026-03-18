"""Add report_templates and report_template_runs tables.

Revision ID: 20260319120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260319120000"
down_revision: Union[str, None] = "20260318120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "report_templates" not in tables:
        op.create_table(
            "report_templates",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("organization_id", sa.String(36), nullable=True),
            sa.Column("source_type", sa.String(50), nullable=False, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("queries", sa.JSON, nullable=False, server_default="[]"),
            sa.Column("layout", sa.String(50), nullable=False, server_default="grid_2x2"),
            sa.Column("refresh_interval", sa.Integer, nullable=False, server_default="3600"),
            sa.Column("is_builtin", sa.Boolean, nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )

    if "report_template_runs" not in tables:
        op.create_table(
            "report_template_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("organization_id", sa.String(36), nullable=True),
            sa.Column("source_id", sa.String(36), nullable=False, index=True),
            sa.Column("template_id", sa.String(36), sa.ForeignKey("report_templates.id"), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("results", sa.JSON, nullable=False, server_default="[]"),
            sa.Column("duration_ms", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "report_template_runs" in tables:
        op.drop_table("report_template_runs")
    if "report_templates" in tables:
        op.drop_table("report_templates")
