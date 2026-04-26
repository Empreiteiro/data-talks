"""Add source_groups table.

A named set of sources that share a single onboarding pass.
Idempotent — `Base.metadata.create_all` runs on dev startup.

Revision ID: 20260425150000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425150000"
down_revision: Union[str, None] = "20260425140000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if "source_groups" in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        "source_groups",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("agent_id", sa.String(length=36), nullable=True),
        sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
        sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True),
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
        "ix_source_groups_organization_id",
        "source_groups",
        ["organization_id"],
    )
    op.create_index(
        "ix_source_groups_agent_id",
        "source_groups",
        ["agent_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "source_groups" in set(sa.inspect(bind).get_table_names()):
        op.drop_index("ix_source_groups_agent_id", "source_groups", if_exists=True)
        op.drop_index(
            "ix_source_groups_organization_id", "source_groups", if_exists=True
        )
        op.drop_table("source_groups")
