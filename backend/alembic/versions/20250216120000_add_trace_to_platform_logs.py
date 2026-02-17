"""Add trace column to platform_logs for LLM tracing.

Revision ID: 20250216120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20250216120000"
down_revision: Union[str, None] = "20250216110000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "platform_logs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("platform_logs")]
        if "trace" not in cols:
            op.add_column("platform_logs", sa.Column("trace", sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "platform_logs" in inspector.get_table_names():
        cols = [c["name"] for c in inspector.get_columns("platform_logs")]
        if "trace" in cols:
            op.drop_column("platform_logs", "trace")
