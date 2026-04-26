"""Add source_filters table.

Filters captured during the source-onboarding flow (date ranges and
category lists). Idempotent — `Base.metadata.create_all` runs on dev
startup and may have already created the table.

Revision ID: 20260425140000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425140000"
down_revision: Union[str, None] = "20260425130000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if "source_filters" in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        "source_filters",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("column", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_source_filters_organization_id",
        "source_filters",
        ["organization_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "source_filters" in set(sa.inspect(bind).get_table_names()):
        op.drop_index(
            "ix_source_filters_organization_id",
            "source_filters",
            if_exists=True,
        )
        op.drop_table("source_filters")
