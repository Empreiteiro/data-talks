"""Add source_warmup_questions table.

Per-source warm-up questions, replacing the workspace-wide storage on
`Agent.suggested_questions` for onboarding-generated entries.
Idempotent (the dev server's `Base.metadata.create_all` may have
already created the table on startup).

Revision ID: 20260425130000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425130000"
down_revision: Union[str, None] = "20260425120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    if "source_warmup_questions" in existing:
        return
    op.create_table(
        "source_warmup_questions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("text", sa.Text(), nullable=False),
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
        "ix_source_warmup_questions_organization_id",
        "source_warmup_questions",
        ["organization_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    if "source_warmup_questions" in existing:
        op.drop_index(
            "ix_source_warmup_questions_organization_id",
            "source_warmup_questions",
            if_exists=True,
        )
        op.drop_table("source_warmup_questions")
