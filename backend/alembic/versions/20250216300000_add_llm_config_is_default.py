"""Add is_default to llm_configs.

Revision ID: 20250216300000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250216300000"
down_revision: Union[str, None] = "20250216200000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "is_default" not in cols:
            op.add_column("llm_configs", sa.Column("is_default", sa.Boolean(), server_default=sa.text("0"), nullable=False))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "llm_configs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("llm_configs")]
        if "is_default" in cols:
            op.drop_column("llm_configs", "is_default")
