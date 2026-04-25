"""Organization management endpoints.

Scope: list the caller's organizations, list members of an org, add an
existing user as a member, change a member's role, and remove a member.
Invites are intentionally out of scope — the product choice in this PR is
"add an existing registered user directly" rather than an email-based
invite flow. Opens the door for an invite model without breaking these
endpoints.

Role rules:
- list orgs:              any member
- list/add/update/remove: admin or owner (per `require_role("admin")`)
- last-owner safety:      the server refuses to remove or demote the
                          only remaining `owner`, regardless of caller
                          role. This prevents locking an org out
                          entirely.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ROLE_HIERARCHY,
    TenantScope,
    require_membership,
    require_role,
)
from app.database import get_db
from app.models import Organization, OrganizationMembership, User, VALID_ROLES


router = APIRouter(prefix="/organizations", tags=["organizations"])


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


@router.get("")
async def list_my_organizations(
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List organizations the caller belongs to, with their role in each."""
    r = await db.execute(
        select(OrganizationMembership, Organization)
        .join(Organization, Organization.id == OrganizationMembership.organization_id)
        .where(OrganizationMembership.user_id == scope.user.id)
        .order_by(OrganizationMembership.created_at.asc())
    )
    return [
        {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "role": m.role,
            "is_active": scope.organization_id == org.id,
            "created_at": org.created_at.isoformat() if org.created_at else None,
        }
        for m, org in r.all()
    ]


async def _ensure_caller_can_manage(
    db: AsyncSession, scope: TenantScope, organization_id: str
) -> None:
    """Manage = read members + write membership.

    The caller's scope org must match the path's organization_id, and their
    role there must be admin or owner. `require_role("admin")` gates the
    role; we separately enforce that `scope.organization_id == org_id` so a
    caller can't mutate an org they're not actively scoped to.
    """
    if scope.organization_id != organization_id:
        raise HTTPException(
            403,
            "Switch to this organization via POST /api/auth/switch-org before managing it.",
        )


@router.get("/{organization_id}/members")
async def list_members(
    organization_id: str,
    scope: TenantScope = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await _ensure_caller_can_manage(db, scope, organization_id)
    r = await db.execute(
        select(OrganizationMembership, User)
        .join(User, User.id == OrganizationMembership.user_id)
        .where(OrganizationMembership.organization_id == organization_id)
        .order_by(OrganizationMembership.created_at.asc())
    )
    return [
        {
            "user_id": u.id,
            "email": u.email,
            "role": m.role,
            "joined_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m, u in r.all()
    ]


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------


class AddMemberBody(BaseModel):
    email: EmailStr
    role: str = "member"


@router.post("/{organization_id}/members")
async def add_member(
    organization_id: str,
    body: AddMemberBody,
    scope: TenantScope = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _ensure_caller_can_manage(db, scope, organization_id)
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of: {', '.join(VALID_ROLES)}")
    # Only owners can create other owners. Admins can add admin/member/viewer.
    if body.role == "owner" and scope.role != "owner":
        raise HTTPException(403, "Only owners can grant the owner role.")

    r = await db.execute(select(User).where(User.email == body.email))
    user = r.scalar_one_or_none()
    if not user:
        raise HTTPException(
            404,
            f"No registered user with email {body.email}. The user must sign up first "
            "before you can add them to the organization.",
        )

    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == scope.user.id,
        )
    )
    if r.scalar_one_or_none():
        raise HTTPException(409, "User is already a member of this organization.")

    m = OrganizationMembership(
        id=str(uuid.uuid4()),
        organization_id=organization_id,
        user_id=scope.user.id,
        role=body.role,
    )
    db.add(m)
    await db.commit()
    return {
        "user_id": scope.user.id,
        "email": scope.user.email,
        "role": body.role,
    }


class UpdateRoleBody(BaseModel):
    role: str


async def _count_owners(db: AsyncSession, organization_id: str) -> int:
    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.role == "owner",
        )
    )
    return len(list(r.scalars().all()))


@router.patch("/{organization_id}/members/{user_id}")
async def update_member_role(
    organization_id: str,
    user_id: str,
    body: UpdateRoleBody,
    scope: TenantScope = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _ensure_caller_can_manage(db, scope, organization_id)
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of: {', '.join(VALID_ROLES)}")

    # Only owners can promote to or demote from owner.
    if body.role == "owner" and scope.role != "owner":
        raise HTTPException(403, "Only owners can grant the owner role.")

    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user_id,
        )
    )
    m = r.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Member not found")

    if m.role == "owner" and body.role != "owner":
        # Demoting last owner is refused.
        if await _count_owners(db, organization_id) <= 1:
            raise HTTPException(
                400, "Cannot demote the last owner of the organization."
            )
        if scope.role != "owner":
            raise HTTPException(403, "Only owners can demote an owner.")

    m.role = body.role
    await db.commit()
    return {"user_id": user_id, "role": body.role}


@router.delete("/{organization_id}/members/{user_id}")
async def remove_member(
    organization_id: str,
    user_id: str,
    scope: TenantScope = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _ensure_caller_can_manage(db, scope, organization_id)
    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user_id,
        )
    )
    m = r.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Member not found")

    if m.role == "owner":
        if await _count_owners(db, organization_id) <= 1:
            raise HTTPException(
                400, "Cannot remove the last owner of the organization."
            )
        if scope.role != "owner":
            raise HTTPException(403, "Only owners can remove an owner.")

    # A non-owner caller is allowed to remove themselves (leave the org)
    # but that's out of scope for this endpoint — use a dedicated
    # /leave action in the future if desired. For now, same gate.
    await db.delete(m)
    await db.commit()
    return {"ok": True, "user_id": user_id}


# ---------------------------------------------------------------------------
# Create org (every authenticated user can create their own)
# ---------------------------------------------------------------------------


class CreateOrgBody(BaseModel):
    name: str
    slug: Optional[str] = None


def _slugify(text: str) -> str:
    import re

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "organization"


@router.post("")
async def create_organization(
    body: CreateOrgBody,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Anyone authenticated can create an organization; they become its owner."""
    base_slug = _slugify(body.slug or body.name)
    slug = base_slug
    suffix = 2
    while True:
        r = await db.execute(select(Organization.id).where(Organization.slug == slug))
        if not r.scalar_one_or_none():
            break
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    org = Organization(
        id=str(uuid.uuid4()),
        name=body.name,
        slug=slug,
        created_by=scope.user.id,
    )
    db.add(org)
    await db.flush()

    membership = OrganizationMembership(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=scope.user.id,
        role="owner",
    )
    db.add(membership)
    await db.commit()

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "role": "owner",
        "created_at": org.created_at.isoformat() if org.created_at else None,
    }
