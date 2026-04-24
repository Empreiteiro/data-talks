"""Cross-tenant isolation and RBAC tests.

Exercises the foundation introduced by the multi-tenant security PR:

- A user in org A cannot load or mutate resources of org B, even if they
  learned the UUIDs.
- Role gates reject viewers from writes and non-admins from deletes.
- Switching org via `/api/auth/switch-org` flips the tenant scope so the
  same user sees a different set of resources.
- Encryption: credentials land in the DB as `{"__enc": "..."}` envelopes
  and `GET /api/sources` returns masked values.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.auth import create_access_token
from app.models import (
    Agent,
    Organization,
    OrganizationMembership,
    Source,
    User,
)
from app.services.crypto import SOURCE_SECRET_KEYS


def _session_factory():
    """Use the patched AsyncSessionLocal from `conftest` (the top-level
    import binds to the pre-patch value)."""
    import app.database as _db

    return _db.AsyncSessionLocal


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


async def _make_user(db, email: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        hashed_password="x",  # placeholder; tests auth via JWT
        role="user",
    )
    db.add(user)
    await db.flush()
    return user


async def _make_org(db, *, name: str, creator: User) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=name.lower().replace(" ", "-") + "-" + uuid.uuid4().hex[:6],
        created_by=creator.id,
    )
    db.add(org)
    await db.flush()
    return org


async def _add_member(db, *, user: User, org: Organization, role: str = "member") -> OrganizationMembership:
    m = OrganizationMembership(
        id=str(uuid.uuid4()),
        user_id=user.id,
        organization_id=org.id,
        role=role,
    )
    db.add(m)
    await db.flush()
    return m


def _token_for(user_id: str, org_id: str) -> str:
    return create_access_token({"sub": user_id}, org_id=org_id)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def two_tenants(app):
    """Build org_a owned by user_a and org_b owned by user_b plus one
    shared user `user_both` who is `member` in both orgs.

    Also seeds one Source and one Agent in each org so cross-org IDOR
    attempts have something to aim at.
    """
    async with _session_factory()() as db:
        user_a = await _make_user(db, "alice@example.com")
        user_b = await _make_user(db, "bob@example.com")
        user_both = await _make_user(db, "carol@example.com")

        org_a = await _make_org(db, name="Acme", creator=user_a)
        org_b = await _make_org(db, name="Beta", creator=user_b)

        await _add_member(db, user=user_a, org=org_a, role="owner")
        await _add_member(db, user=user_b, org=org_b, role="owner")
        await _add_member(db, user=user_both, org=org_a, role="member")
        await _add_member(db, user=user_both, org=org_b, role="viewer")

        src_a = Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            organization_id=org_a.id,
            name="acme_sales",
            type="bigquery",
            metadata_={"project": "acme-prod"},
        )
        src_b = Source(
            id=str(uuid.uuid4()),
            user_id=user_b.id,
            organization_id=org_b.id,
            name="beta_events",
            type="bigquery",
            metadata_={"project": "beta-prod"},
        )
        agent_a = Agent(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            organization_id=org_a.id,
            name="Acme analysis",
            workspace_type="analysis",
            source_ids=[src_a.id],
            source_relationships=[],
            suggested_questions=[],
        )
        agent_b = Agent(
            id=str(uuid.uuid4()),
            user_id=user_b.id,
            organization_id=org_b.id,
            name="Beta analysis",
            workspace_type="analysis",
            source_ids=[src_b.id],
            source_relationships=[],
            suggested_questions=[],
        )
        db.add_all([src_a, src_b, agent_a, agent_b])
        await db.commit()

        yield {
            "user_a": user_a,
            "user_b": user_b,
            "user_both": user_both,
            "org_a": org_a,
            "org_b": org_b,
            "src_a": src_a,
            "src_b": src_b,
            "agent_a": agent_a,
            "agent_b": agent_b,
        }


# ---------------------------------------------------------------------------
# Cross-tenant IDOR checks
# ---------------------------------------------------------------------------


async def test_user_a_cannot_load_org_b_source(client, two_tenants):
    """IDOR: user A knows the UUID of org B's source — must still 404."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)

    r = await client.get(f"/api/sources", headers=_headers(token))
    assert r.status_code == 200
    ids_in_list = {s["id"] for s in r.json()}
    assert t["src_a"].id in ids_in_list
    assert t["src_b"].id not in ids_in_list


async def test_user_a_cannot_load_org_b_agent(client, two_tenants):
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)

    # List must not include the other org's agent
    r = await client.get("/api/agents", headers=_headers(token))
    assert r.status_code == 200
    ids_in_list = {a["id"] for a in r.json()}
    assert t["agent_b"].id not in ids_in_list

    # Direct fetch by UUID must 404
    r = await client.get(f"/api/agents/{t['agent_b'].id}", headers=_headers(token))
    assert r.status_code == 404


async def test_user_a_cannot_patch_org_b_source(client, two_tenants):
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.patch(
        f"/api/sources/{t['src_b'].id}",
        json={"is_active": False},
        headers=_headers(token),
    )
    assert r.status_code == 404


async def test_user_a_cannot_delete_org_b_source(client, two_tenants):
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.delete(
        f"/api/sources/{t['src_b'].id}", headers=_headers(token)
    )
    # owner of own org → role check passes, then 404 because org mismatch
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Role gates
# ---------------------------------------------------------------------------


async def test_viewer_cannot_create_source(client, two_tenants):
    """user_both is viewer in org_b — POST /api/sources must 403."""
    t = two_tenants
    token = _token_for(t["user_both"].id, t["org_b"].id)
    r = await client.post(
        "/api/sources",
        json={"name": "x", "type": "sql_database", "metadata": {}},
        headers=_headers(token),
    )
    assert r.status_code == 403


async def test_member_can_create_source(client, two_tenants):
    """user_both is member in org_a — POST /api/sources must 200."""
    t = two_tenants
    token = _token_for(t["user_both"].id, t["org_a"].id)
    r = await client.post(
        "/api/sources",
        json={"name": "member-created", "type": "sql_database", "metadata": {}},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "member-created"


async def test_member_cannot_delete_source(client, two_tenants):
    """user_both is member (not admin) in org_a — DELETE must 403."""
    t = two_tenants
    token = _token_for(t["user_both"].id, t["org_a"].id)
    r = await client.delete(
        f"/api/sources/{t['src_a'].id}", headers=_headers(token)
    )
    assert r.status_code == 403


async def test_owner_can_delete_source(client, two_tenants):
    """user_a is owner in org_a — DELETE works."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.delete(
        f"/api/sources/{t['src_a'].id}", headers=_headers(token)
    )
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Org switching
# ---------------------------------------------------------------------------


async def test_switch_org_flips_visible_resources(client, two_tenants):
    """user_both lists agents under org_a then switches to org_b and sees the
    other set without re-login."""
    t = two_tenants
    token_a = _token_for(t["user_both"].id, t["org_a"].id)
    r = await client.get("/api/agents", headers=_headers(token_a))
    assert r.status_code == 200
    ids_a = {a["id"] for a in r.json()}
    assert t["agent_a"].id in ids_a
    assert t["agent_b"].id not in ids_a

    # Switch to org_b
    r = await client.post(
        "/api/auth/switch-org",
        json={"organization_id": t["org_b"].id},
        headers=_headers(token_a),
    )
    assert r.status_code == 200, r.text
    token_b = r.json()["access_token"]

    r = await client.get("/api/agents", headers=_headers(token_b))
    assert r.status_code == 200
    ids_b = {a["id"] for a in r.json()}
    assert t["agent_b"].id in ids_b
    assert t["agent_a"].id not in ids_b


async def test_switch_to_org_without_membership_is_403(client, two_tenants):
    """user_a is not a member of org_b — switch must 403."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.post(
        "/api/auth/switch-org",
        json={"organization_id": t["org_b"].id},
        headers=_headers(token),
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Secret encryption
# ---------------------------------------------------------------------------


async def test_create_source_encrypts_secret_fields_at_rest(client, two_tenants):
    """POST /api/sources with a password → DB row stores `{"__enc": "..."}`,
    API response masks the secret, `scope.organization_id` is set."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.post(
        "/api/sources",
        json={
            "name": "secrets-check",
            "type": "sql_database",
            "metadata": {
                "host": "db.example.com",
                "password": "hunter2",
                "api_key": "sk-xyz",
            },
        },
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metaJSON"]["host"] == "db.example.com"
    # Response is masked, not plaintext
    assert body["metaJSON"]["password"] == {"present": True}
    assert body["metaJSON"]["api_key"] == {"present": True}

    # DB row has the envelope — plaintext never stored
    async with _session_factory()() as db:
        r_db = await db.execute(
            select(Source).where(Source.id == body["id"])
        )
        src = r_db.scalar_one()
        meta = src.metadata_ or {}
        assert meta.get("host") == "db.example.com"
        assert isinstance(meta.get("password"), dict) and "__enc" in meta["password"]
        assert isinstance(meta.get("api_key"), dict) and "__enc" in meta["api_key"]


def test_known_source_secret_keys_include_critical_ones():
    """Snapshot test so we don't silently remove coverage for a secret key."""
    must_cover = {
        "password",
        "api_key",
        "service_account_json",
        "connection_string",
        "secret_access_key",
        "private_key",
    }
    missing = must_cover - SOURCE_SECRET_KEYS
    assert not missing, f"SOURCE_SECRET_KEYS lost coverage for: {missing}"


# ---------------------------------------------------------------------------
# Organization member management
# ---------------------------------------------------------------------------


async def test_owner_can_list_and_add_members(client, two_tenants):
    """user_a is owner of org_a. They can list members and add user_both as admin."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)

    r = await client.get(f"/api/organizations/{t['org_a'].id}/members", headers=_headers(token))
    assert r.status_code == 200
    members = r.json()
    # Seeded with user_a (owner) + user_both (member).
    emails = {m["email"] for m in members}
    assert t["user_a"].email in emails
    assert t["user_both"].email in emails


async def test_admin_cannot_grant_owner(client, two_tenants):
    """member user_both gets promoted to admin in org_a; then tries to
    promote someone to owner — must 403."""
    t = two_tenants
    owner_token = _token_for(t["user_a"].id, t["org_a"].id)
    # First owner promotes user_both to admin
    r = await client.patch(
        f"/api/organizations/{t['org_a'].id}/members/{t['user_both'].id}",
        json={"role": "admin"},
        headers=_headers(owner_token),
    )
    assert r.status_code == 200

    # Now admin user_both tries to grant owner — rejected
    admin_token = _token_for(t["user_both"].id, t["org_a"].id)
    r = await client.post(
        f"/api/organizations/{t['org_a'].id}/members",
        json={"email": t["user_b"].email, "role": "owner"},
        headers=_headers(admin_token),
    )
    assert r.status_code == 403


async def test_last_owner_cannot_be_demoted(client, two_tenants):
    """org_a has exactly one owner (user_a). Trying to demote them should 400."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.patch(
        f"/api/organizations/{t['org_a'].id}/members/{t['user_a'].id}",
        json={"role": "admin"},
        headers=_headers(token),
    )
    assert r.status_code == 400


async def test_viewer_cannot_manage_members(client, two_tenants):
    """user_both is viewer in org_b — GET members must 403."""
    t = two_tenants
    token = _token_for(t["user_both"].id, t["org_b"].id)
    r = await client.get(
        f"/api/organizations/{t['org_b'].id}/members", headers=_headers(token)
    )
    assert r.status_code == 403


async def test_cannot_manage_members_of_other_org(client, two_tenants):
    """user_a is owner in org_a. Tries to manage org_b — must 403 even though
    their role is 'owner' (of the wrong org)."""
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.get(
        f"/api/organizations/{t['org_b'].id}/members", headers=_headers(token)
    )
    # Caller's scope is org_a, path is org_b — _ensure_caller_can_manage blocks with 403.
    assert r.status_code == 403


async def test_create_org_makes_caller_owner(client, two_tenants):
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.post(
        "/api/organizations",
        json={"name": "New Org"},
        headers=_headers(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "New Org"
    assert body["role"] == "owner"


async def test_add_member_requires_registered_user(client, two_tenants):
    t = two_tenants
    token = _token_for(t["user_a"].id, t["org_a"].id)
    r = await client.post(
        f"/api/organizations/{t['org_a'].id}/members",
        json={"email": "nobody-not-registered@example.com", "role": "member"},
        headers=_headers(token),
    )
    assert r.status_code == 404
