"""Add medallion architecture tables (MedallionLayer, MedallionBuildLog).

Revision ID: 20260407120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260407120000"
down_revision: Union[str, None] = "20260319120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "medallion_layers" not in tables:
        op.create_table(
            "medallion_layers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("source_id", sa.String(36), sa.ForeignKey("sources.id"), nullable=False, index=True),
            sa.Column("agent_id", sa.String(36), nullable=False),
            sa.Column("layer", sa.String(10), nullable=False),
            sa.Column("table_name", sa.String(255), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("schema_config", sa.JSON, nullable=False, server_default="{}"),
            sa.Column("ddl_sql", sa.Text, nullable=False, server_default=""),
            sa.Column("transform_sql", sa.Text, nullable=True),
            sa.Column("row_count", sa.Integer, nullable=True),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        )

    if "medallion_build_logs" not in tables:
        op.create_table(
            "medallion_build_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "layer_id",
                sa.String(36),
                sa.ForeignKey("medallion_layers.id", ondelete="SET NULL"),
                nullable=True,
                index=True,
            ),
            sa.Column("source_id", sa.String(36), nullable=False, index=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("action", sa.String(30), nullable=False),
            sa.Column("layer", sa.String(10), nullable=False),
            sa.Column("input_feedback", sa.Text, nullable=True),
            sa.Column("suggestion", sa.JSON, nullable=True),
            sa.Column("applied_config", sa.JSON, nullable=True),
            sa.Column("llm_usage", sa.JSON, nullable=True),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("medallion_build_logs")
    op.drop_table("medallion_layers")
