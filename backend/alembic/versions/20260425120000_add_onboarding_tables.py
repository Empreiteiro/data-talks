"""Add onboarding tables: source_clarifications and organization_kpis.

These power the guided onboarding flow (Task 3 in TASKS.md). KPIs are
workspace-wide so they can be reused across sources (e.g. a panel that
mixes data from multiple sources). Clarifications are per-source.

Both tables carry an indexed `organization_id` so tenant-scoped queries
remain a single indexed lookup, mirroring the convention every other
multi-tenant table in this repo follows.

Revision ID: 20260425120000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425120000"
down_revision: Union[str, None] = "20260424120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: app/main.py runs `Base.metadata.create_all` on every
    # startup, so on dev machines where the server has already booted
    # after the model was added, these tables exist before alembic
    # upgrade gets a chance. Skip what's already there.
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    if "source_clarifications" in existing and "organization_kpis" in existing:
        return

    if "source_clarifications" in existing:
        # one of the two already exists — guard each create_table below
        pass

    if "source_clarifications" not in existing:
        _create_source_clarifications()
    if "organization_kpis" not in existing:
        _create_organization_kpis()


def _create_source_clarifications() -> None:
    op.create_table(
        "source_clarifications",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column(
            "source_id",
            sa.String(length=36),
            sa.ForeignKey("sources.id"),
            nullable=False,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
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
        "ix_source_clarifications_organization_id",
        "source_clarifications",
        ["organization_id"],
    )
    op.create_index(
        "ix_source_clarifications_source_id",
        "source_clarifications",
        ["source_id"],
    )


def _create_organization_kpis() -> None:
    op.create_table(
        "organization_kpis",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("definition", sa.Text(), nullable=False),
        # JSON columns: SQLAlchemy `JSON` type maps to JSON on PG and TEXT
        # on SQLite — both accept Python list/dict round-trips.
        sa.Column("source_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("dependencies", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "created_by_user_id", sa.String(length=36), nullable=True
        ),
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
        "ix_organization_kpis_organization_id",
        "organization_kpis",
        ["organization_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    if "organization_kpis" in existing:
        op.drop_index(
            "ix_organization_kpis_organization_id",
            "organization_kpis",
            if_exists=True,
        )
        op.drop_table("organization_kpis")
    if "source_clarifications" in existing:
        op.drop_index(
            "ix_source_clarifications_source_id",
            "source_clarifications",
            if_exists=True,
        )
        op.drop_index(
            "ix_source_clarifications_organization_id",
            "source_clarifications",
            if_exists=True,
        )
        op.drop_table("source_clarifications")
