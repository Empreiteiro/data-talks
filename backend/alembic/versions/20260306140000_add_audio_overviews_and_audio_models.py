"""Add audio overview storage and audio model fields.

Revision ID: 20260306140000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260306140000"
down_revision: Union[str, None] = "20250216300000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "llm_settings" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "openai_audio_model" not in cols:
            op.add_column("llm_settings", sa.Column("openai_audio_model", sa.String(64), nullable=True))
        if "litellm_audio_model" not in cols:
            op.add_column("llm_settings", sa.Column("litellm_audio_model", sa.String(64), nullable=True))

    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "openai_audio_model" not in cols:
            op.add_column("llm_configs", sa.Column("openai_audio_model", sa.String(64), nullable=True))
        if "litellm_audio_model" not in cols:
            op.add_column("llm_configs", sa.Column("litellm_audio_model", sa.String(64), nullable=True))

    if "audio_overviews" not in inspector.get_table_names():
        op.create_table(
            "audio_overviews",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=False),
            sa.Column("source_id", sa.String(36), nullable=False),
            sa.Column("source_name", sa.String(255), nullable=False),
            sa.Column("script", sa.Text(), nullable=False),
            sa.Column("audio_file_path", sa.String(512), nullable=False),
            sa.Column("mime_type", sa.String(64), nullable=False, server_default=sa.text("'audio/mpeg'")),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "audio_overviews" in inspector.get_table_names():
        op.drop_table("audio_overviews")

    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "litellm_audio_model" in cols:
            op.drop_column("llm_configs", "litellm_audio_model")
        if "openai_audio_model" in cols:
            op.drop_column("llm_configs", "openai_audio_model")

    if "llm_settings" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "litellm_audio_model" in cols:
            op.drop_column("llm_settings", "litellm_audio_model")
        if "openai_audio_model" in cols:
            op.drop_column("llm_settings", "openai_audio_model")
