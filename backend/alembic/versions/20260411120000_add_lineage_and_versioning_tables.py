"""Add lineage and pipeline versioning tables.

Creates:
- pipeline_runs: one row per instrumented execution (medallion build, Q&A, future DAG runs)
- lineage_edges: append-only edges captured per run (source->target, stringly-typed refs)
- pipeline_versions: immutable snapshots of pipeline JSON with diff/restore support
- github_connections: per-user OAuth state + encrypted tokens + selected repo

Revision ID: 20260411120000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260411120000"
down_revision: Union[str, None] = "20260407130000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "pipeline_runs" not in tables:
        op.create_table(
            "pipeline_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False, index=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=True, index=True),
            sa.Column("pipeline_id", sa.String(64), nullable=True, index=True),
            sa.Column("kind", sa.String(30), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="running"),
            sa.Column("started_at", sa.DateTime, nullable=False, server_default=sa.func.now(), index=True),
            sa.Column("finished_at", sa.DateTime, nullable=True),
            sa.Column("duration_ms", sa.Integer, nullable=True),
            sa.Column("error_message", sa.Text, nullable=True),
            sa.Column("metadata", sa.JSON, nullable=False, server_default="{}"),
        )

    if "lineage_edges" not in tables:
        op.create_table(
            "lineage_edges",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "run_id",
                sa.String(36),
                sa.ForeignKey("pipeline_runs.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("source_kind", sa.String(20), nullable=False),
            sa.Column("source_ref", sa.String(512), nullable=False, index=True),
            sa.Column("target_kind", sa.String(20), nullable=False),
            sa.Column("target_ref", sa.String(512), nullable=False, index=True),
            sa.Column("edge_type", sa.String(20), nullable=False),
            sa.Column("metadata", sa.JSON, nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )

    if "pipeline_versions" not in tables:
        # Unique constraint is declared inline so SQLite can create it
        # (SQLite cannot ALTER TABLE ADD CONSTRAINT after the fact).
        op.create_table(
            "pipeline_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("agent_id", sa.String(36), nullable=False, index=True),
            sa.Column("pipeline_id", sa.String(64), nullable=False, index=True),
            sa.Column("version_number", sa.Integer, nullable=False),
            sa.Column("snapshot", sa.JSON, nullable=False, server_default="{}"),
            sa.Column("message", sa.String(512), nullable=True),
            sa.Column("author_user_id", sa.String(36), nullable=True),
            sa.Column("parent_version_id", sa.String(36), nullable=True),
            sa.Column("restored_from_version_id", sa.String(36), nullable=True),
            sa.Column("github_commit_sha", sa.String(64), nullable=True),
            sa.Column("github_commit_url", sa.String(1024), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint(
                "agent_id",
                "pipeline_id",
                "version_number",
                name="uq_pipeline_versions_agent_pipeline_number",
            ),
        )

    if "github_connections" not in tables:
        op.create_table(
            "github_connections",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
            sa.Column("github_user_id", sa.Integer, nullable=True),
            sa.Column("github_login", sa.String(128), nullable=True),
            sa.Column("access_token_enc", sa.Text, nullable=False),
            sa.Column("refresh_token_enc", sa.Text, nullable=True),
            sa.Column("token_expires_at", sa.DateTime, nullable=True),
            sa.Column("scopes", sa.String(256), nullable=True),
            sa.Column("selected_repo_full_name", sa.String(255), nullable=True),
            sa.Column("selected_branch", sa.String(128), nullable=False, server_default="main"),
            sa.Column(
                "selected_base_path",
                sa.String(512),
                nullable=False,
                server_default="data-talks/pipelines",
            ),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("github_connections")
    op.drop_constraint("uq_pipeline_versions_agent_pipeline_number", "pipeline_versions", type_="unique")
    op.drop_table("pipeline_versions")
    op.drop_table("lineage_edges")
    op.drop_table("pipeline_runs")
