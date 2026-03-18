"""Add google and anthropic provider fields to llm settings/configs.

Revision ID: 20260318120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260318120000"
down_revision: Union[str, None] = "65a4c2b4de29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_COLUMNS = [
    ("google_api_key", sa.String(512)),
    ("google_model", sa.String(64)),
    ("anthropic_api_key", sa.String(512)),
    ("anthropic_model", sa.String(64)),
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    for table in ("llm_settings", "llm_configs"):
        if table not in inspector.get_table_names():
            continue
        cols = [c["name"] for c in inspector.get_columns(table)]
        for col_name, col_type in _NEW_COLUMNS:
            if col_name not in cols:
                op.add_column(table, sa.Column(col_name, col_type, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    for table in ("llm_configs", "llm_settings"):
        if table not in inspector.get_table_names():
            continue
        cols = [c["name"] for c in inspector.get_columns(table)]
        for col_name, _ in _NEW_COLUMNS:
            if col_name in cols:
                op.drop_column(table, col_name)
