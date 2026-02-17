"""Add llm_configs table and agent.llm_config_id.

Revision ID: 20250216200000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250216200000"
down_revision: Union[str, None] = "20250216120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "llm_configs" not in inspector.get_table_names():
        op.create_table(
            "llm_configs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("llm_provider", sa.String(20), server_default=sa.text("'openai'")),
            sa.Column("openai_api_key", sa.String(512), nullable=True),
            sa.Column("openai_model", sa.String(64), nullable=True),
            sa.Column("ollama_base_url", sa.String(256), nullable=True),
            sa.Column("ollama_model", sa.String(64), nullable=True),
            sa.Column("litellm_base_url", sa.String(256), nullable=True),
            sa.Column("litellm_model", sa.String(64), nullable=True),
            sa.Column("litellm_api_key", sa.String(512), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
    # Add llm_config_id to agents if not present
    if "agents" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("agents")]
        if "llm_config_id" not in cols:
            op.add_column("agents", sa.Column("llm_config_id", sa.String(36), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "agents" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("agents")]
        if "llm_config_id" in cols:
            op.drop_column("agents", "llm_config_id")
    if "llm_configs" in inspector.get_table_names():
        op.drop_table("llm_configs")
