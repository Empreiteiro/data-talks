"""Add organization_id to Dashboard, DashboardChart, QASession, Alert, AlertExecution.

The prior multi-tenant migration tackled the core tenant-scoped models
(Source, Agent, pipeline_*, api_keys, github_connections). These five
trailed behind with user_id-only isolation. This migration brings them
under the tenant scope so the CI lint (next commit) can fail when new
code queries them without an `organization_id` predicate.

Backfill strategy: inherit `organization_id` from the row's user
(`users.organization_id`). For AlertExecution and DashboardChart — which
don't have a direct user_id — inherit from their parent Alert /
Dashboard.

Revision ID: 20260414120000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260414120000"
down_revision: Union[str, None] = "20260413130000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(inspector, table: str) -> set[str]:
    try:
        return {c["name"] for c in inspector.get_columns(table)}
    except Exception:  # noqa: BLE001 — table might not exist
        return set()


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # --- simple add + backfill from users.organization_id -------------------
    simple = [
        "dashboards",
        "qa_sessions",
        "alerts",
    ]
    for table in simple:
        if table not in tables:
            continue
        cols = _columns(inspector, table)
        if "organization_id" in cols:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                f"UPDATE {table} SET organization_id = ("
                "  SELECT users.organization_id FROM users "
                f"  WHERE users.id = {table}.user_id"
                ") WHERE organization_id IS NULL"
            )
        )
        # Fill any remaining NULLs (orphan rows with no matching user) with
        # a per-row synthetic UUID so the NOT NULL invariant holds.
        orphans = conn.execute(
            sa.text(f"SELECT id FROM {table} WHERE organization_id IS NULL")
        ).fetchall()
        for r in orphans:
            conn.execute(
                sa.text(f"UPDATE {table} SET organization_id = lower(hex(randomblob(16))) WHERE id = :id"),
                {"id": r[0]},
            )
        with op.batch_alter_table(table) as batch:
            batch.create_index(f"ix_{table}_organization_id", ["organization_id"])

    # --- dashboard_charts: inherit from parent dashboard --------------------
    if "dashboard_charts" in tables and "organization_id" not in _columns(
        inspector, "dashboard_charts"
    ):
        with op.batch_alter_table("dashboard_charts") as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                "UPDATE dashboard_charts SET organization_id = ("
                "  SELECT dashboards.organization_id FROM dashboards "
                "  WHERE dashboards.id = dashboard_charts.dashboard_id"
                ") WHERE organization_id IS NULL"
            )
        )
        orphans = conn.execute(
            sa.text("SELECT id FROM dashboard_charts WHERE organization_id IS NULL")
        ).fetchall()
        for r in orphans:
            conn.execute(
                sa.text(
                    "UPDATE dashboard_charts SET organization_id = lower(hex(randomblob(16))) WHERE id = :id"
                ),
                {"id": r[0]},
            )
        with op.batch_alter_table("dashboard_charts") as batch:
            batch.create_index(
                "ix_dashboard_charts_organization_id", ["organization_id"]
            )

    # --- alert_executions: inherit from parent alert ------------------------
    if "alert_executions" in tables and "organization_id" not in _columns(
        inspector, "alert_executions"
    ):
        with op.batch_alter_table("alert_executions") as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                "UPDATE alert_executions SET organization_id = ("
                "  SELECT alerts.organization_id FROM alerts "
                "  WHERE alerts.id = alert_executions.alert_id"
                ") WHERE organization_id IS NULL"
            )
        )
        orphans = conn.execute(
            sa.text("SELECT id FROM alert_executions WHERE organization_id IS NULL")
        ).fetchall()
        for r in orphans:
            conn.execute(
                sa.text(
                    "UPDATE alert_executions SET organization_id = lower(hex(randomblob(16))) WHERE id = :id"
                ),
                {"id": r[0]},
            )
        with op.batch_alter_table("alert_executions") as batch:
            batch.create_index(
                "ix_alert_executions_organization_id", ["organization_id"]
            )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in (
        "alert_executions",
        "dashboard_charts",
        "alerts",
        "qa_sessions",
        "dashboards",
    ):
        try:
            cols = _columns(inspector, table)
        except Exception:  # noqa: BLE001
            continue
        if "organization_id" not in cols:
            continue
        with op.batch_alter_table(table) as batch:
            try:
                batch.drop_index(f"ix_{table}_organization_id")
            except Exception:  # noqa: BLE001
                pass
            batch.drop_column("organization_id")
