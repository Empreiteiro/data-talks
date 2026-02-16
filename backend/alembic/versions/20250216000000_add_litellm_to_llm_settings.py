"""Add LiteLLM columns to llm_settings.

Revision ID: 20250216000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250216000000"
down_revision: Union[str, None] = "20250606000000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ensure llm_settings exists (may have been created by create_all)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "llm_settings" not in inspector.get_table_names():
        op.create_table(
            "llm_settings",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
            sa.Column("llm_provider", sa.String(20), server_default=sa.text("'openai'")),
            sa.Column("openai_api_key", sa.String(512), nullable=True),
            sa.Column("openai_model", sa.String(64), nullable=True),
            sa.Column("ollama_base_url", sa.String(256), nullable=True),
            sa.Column("ollama_model", sa.String(64), nullable=True),
            sa.Column("litellm_base_url", sa.String(256), nullable=True),
            sa.Column("litellm_model", sa.String(64), nullable=True),
            sa.Column("litellm_api_key", sa.String(512), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
    else:
        # Add litellm columns if they don't exist
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "litellm_base_url" not in cols:
            op.add_column("llm_settings", sa.Column("litellm_base_url", sa.String(256), nullable=True))
        if "litellm_model" not in cols:
            op.add_column("llm_settings", sa.Column("litellm_model", sa.String(64), nullable=True))
        if "litellm_api_key" not in cols:
            op.add_column("llm_settings", sa.Column("litellm_api_key", sa.String(512), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "llm_settings" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "litellm_api_key" in cols:
            op.drop_column("llm_settings", "litellm_api_key")
        if "litellm_model" in cols:
            op.drop_column("llm_settings", "litellm_model")
        if "litellm_base_url" in cols:
            op.drop_column("llm_settings", "litellm_base_url")
