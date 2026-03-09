"""Add openai_base_url to llm settings/configs.

Revision ID: 20260309120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260309120000"
down_revision: Union[str, None] = "20260306140000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "llm_settings" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "openai_base_url" not in cols:
            op.add_column("llm_settings", sa.Column("openai_base_url", sa.String(512), nullable=True))

    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "openai_base_url" not in cols:
            op.add_column("llm_configs", sa.Column("openai_base_url", sa.String(512), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "openai_base_url" in cols:
            op.drop_column("llm_configs", "openai_base_url")

    if "llm_settings" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_settings")]
        if "openai_base_url" in cols:
            op.drop_column("llm_settings", "openai_base_url")
