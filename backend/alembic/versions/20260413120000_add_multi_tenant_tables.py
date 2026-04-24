"""Add organizations, organization_memberships, and tenant columns.

Creates the foundation for multi-tenant isolation:

- `organizations` and `organization_memberships` tables
- Per-user backfill: one Organization per existing user (or a "Guest" org for
  the guest user), with an `owner` membership row
- `organization_id` columns on newer models that were missing it
  (lineage_edges, pipeline_versions, github_connections, api_keys) with
  backfill via the owning user's primary organization
- Retargets `github_connections.primary key` from (user_id) to
  (user_id, organization_id) so a user can connect different GitHub accounts
  in different organizations

Revision ID: 20260413120000
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260413120000"
down_revision: Union[str, None] = "20260411120000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_GUEST_USER_ID = "00000000-0000-0000-0000-000000000001"
_GUEST_ORG_SLUG = "guest-workspace"


def _slugify(text: str) -> str:
    """Tiny slug helper (no external deps). Keeps alphanumerics + dashes."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "workspace"


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # ------------------------------------------------------------------
    # 1. Create organizations + organization_memberships
    # ------------------------------------------------------------------
    if "organizations" not in tables:
        op.create_table(
            "organizations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("slug", sa.String(64), nullable=False, unique=True, index=True),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        )

    if "organization_memberships" not in tables:
        op.create_table(
            "organization_memberships",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("organization_id", "user_id", name="uq_org_member_org_user"),
        )

    # ------------------------------------------------------------------
    # 2. Backfill: create a personal org + owner membership per user
    # ------------------------------------------------------------------
    users = conn.execute(sa.text("SELECT id, email, organization_id FROM users")).fetchall()
    used_slugs: set[str] = set()
    now = datetime.utcnow()

    for row in users:
        user_id = row[0]
        email = row[1] or ""
        existing_membership = conn.execute(
            sa.text(
                "SELECT id FROM organization_memberships WHERE user_id = :uid LIMIT 1"
            ),
            {"uid": user_id},
        ).fetchone()
        if existing_membership:
            continue

        if user_id == _GUEST_USER_ID:
            name = "Guest workspace"
            slug = _GUEST_ORG_SLUG
        else:
            local = email.split("@", 1)[0] if "@" in email else email
            name = f"{local or user_id[:8]}'s workspace"
            slug = _slugify(local) or f"ws-{user_id[:8]}"

        # Ensure uniqueness of slug against the DB and within this migration
        candidate = slug
        suffix = 2
        while candidate in used_slugs or conn.execute(
            sa.text("SELECT 1 FROM organizations WHERE slug = :s"), {"s": candidate}
        ).fetchone():
            candidate = f"{slug}-{suffix}"
            suffix += 1
        used_slugs.add(candidate)

        org_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at) "
                "VALUES (:id, :name, :slug, :cb, :ts, :ts)"
            ),
            {"id": org_id, "name": name, "slug": candidate, "cb": user_id, "ts": now},
        )
        conn.execute(
            sa.text(
                "INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at) "
                "VALUES (:id, :oid, :uid, 'owner', :ts)"
            ),
            {"id": str(uuid.uuid4()), "oid": org_id, "uid": user_id, "ts": now},
        )
        # Set the user's "last active" hint if empty
        conn.execute(
            sa.text(
                "UPDATE users SET organization_id = :oid WHERE id = :uid "
                "AND (organization_id IS NULL OR organization_id = '')"
            ),
            {"oid": org_id, "uid": user_id},
        )

    # ------------------------------------------------------------------
    # 3. Add organization_id to newer models
    # ------------------------------------------------------------------

    def _column_names(table: str) -> set[str]:
        if table not in tables:
            return set()
        return {c["name"] for c in inspector.get_columns(table)}

    # ---- api_keys.organization_id NOT NULL (backfill via user's primary org)
    api_cols = _column_names("api_keys")
    if "api_keys" in tables and "organization_id" not in api_cols:
        with op.batch_alter_table("api_keys") as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                "UPDATE api_keys SET organization_id = ("
                "  SELECT users.organization_id FROM users WHERE users.id = api_keys.user_id"
                ") WHERE organization_id IS NULL"
            )
        )
        # Any row still null (e.g. orphaned API keys) gets a synthetic org so NOT NULL works.
        orphan_rows = conn.execute(
            sa.text("SELECT id, user_id FROM api_keys WHERE organization_id IS NULL")
        ).fetchall()
        for r in orphan_rows:
            conn.execute(
                sa.text("UPDATE api_keys SET organization_id = :oid WHERE id = :id"),
                {"oid": str(uuid.uuid4()), "id": r[0]},
            )
        with op.batch_alter_table("api_keys") as batch:
            batch.alter_column("organization_id", existing_type=sa.String(36), nullable=False)
            batch.create_index("ix_api_keys_organization_id", ["organization_id"])

    # ---- lineage_edges.organization_id (backfill from pipeline_runs)
    le_cols = _column_names("lineage_edges")
    if "lineage_edges" in tables and "organization_id" not in le_cols:
        with op.batch_alter_table("lineage_edges") as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                "UPDATE lineage_edges SET organization_id = ("
                "  SELECT pipeline_runs.organization_id FROM pipeline_runs "
                "  WHERE pipeline_runs.id = lineage_edges.run_id"
                ") WHERE organization_id IS NULL"
            )
        )
        with op.batch_alter_table("lineage_edges") as batch:
            batch.create_index("ix_lineage_edges_organization_id", ["organization_id"])

    # ---- pipeline_versions.organization_id (backfill via user's primary org)
    pv_cols = _column_names("pipeline_versions")
    if "pipeline_versions" in tables and "organization_id" not in pv_cols:
        with op.batch_alter_table("pipeline_versions") as batch:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        conn.execute(
            sa.text(
                "UPDATE pipeline_versions SET organization_id = ("
                "  SELECT users.organization_id FROM users "
                "  WHERE users.id = pipeline_versions.user_id"
                ") WHERE organization_id IS NULL"
            )
        )
        with op.batch_alter_table("pipeline_versions") as batch:
            batch.create_index("ix_pipeline_versions_organization_id", ["organization_id"])

    # ---- github_connections: composite pk (user_id, organization_id).
    # SQLite cannot alter a primary key in place, so we rebuild the table.
    gh_cols = _column_names("github_connections")
    if "github_connections" in tables and "organization_id" not in gh_cols:
        existing_rows = conn.execute(sa.text("SELECT * FROM github_connections")).mappings().all()
        op.drop_table("github_connections")
        op.create_table(
            "github_connections",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
            sa.Column("organization_id", sa.String(36), primary_key=True, index=True),
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
            sa.UniqueConstraint("user_id", "organization_id", name="uq_github_conn_user_org"),
        )
        # Reinsert rows, filling organization_id from the user's primary org.
        for row in existing_rows:
            r = dict(row)
            org = conn.execute(
                sa.text("SELECT organization_id FROM users WHERE id = :uid"),
                {"uid": r["user_id"]},
            ).fetchone()
            r["organization_id"] = (org[0] if org else None) or str(uuid.uuid4())
            conn.execute(
                sa.text(
                    "INSERT INTO github_connections (user_id, organization_id, github_user_id, "
                    "github_login, access_token_enc, refresh_token_enc, token_expires_at, scopes, "
                    "selected_repo_full_name, selected_branch, selected_base_path, created_at, updated_at) "
                    "VALUES (:user_id, :organization_id, :github_user_id, :github_login, "
                    ":access_token_enc, :refresh_token_enc, :token_expires_at, :scopes, "
                    ":selected_repo_full_name, :selected_branch, :selected_base_path, :created_at, :updated_at)"
                ),
                r,
            )


def downgrade() -> None:
    # Best-effort downgrade — drops the membership/organization tables and
    # the added tenant columns. Existing rows are kept; callers that relied
    # on organization_id will need to be reverted separately.
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table, col in (
        ("pipeline_versions", "organization_id"),
        ("lineage_edges", "organization_id"),
        ("api_keys", "organization_id"),
    ):
        if table in tables and col in {c["name"] for c in inspector.get_columns(table)}:
            with op.batch_alter_table(table) as batch:
                try:
                    batch.drop_index(f"ix_{table}_{col}")
                except Exception:
                    pass
                batch.drop_column(col)

    if "organization_memberships" in tables:
        op.drop_table("organization_memberships")
    if "organizations" in tables:
        op.drop_table("organizations")
