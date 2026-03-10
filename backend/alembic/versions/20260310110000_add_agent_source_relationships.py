"""Add source_relationships to agents.

Revision ID: 20260310110000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260310110000"
down_revision: Union[str, Sequence[str], None] = ("20260309120000", "0813fd373e14")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "agents" not in inspector.get_table_names():
        return
    cols = [c["name"] for c in inspector.get_columns("agents")]
    if "source_relationships" not in cols:
        op.add_column("agents", sa.Column("source_relationships", sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "agents" not in inspector.get_table_names():
        return
    cols = [c["name"] for c in inspector.get_columns("agents")]
    if "source_relationships" in cols:
        op.drop_column("agents", "source_relationships")
