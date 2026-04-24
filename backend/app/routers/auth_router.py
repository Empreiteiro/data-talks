"""Authentication + organization membership endpoints.

Endpoints:
  POST /auth/register    (guest/email-password mode only)
  POST /auth/login       returns JWT bound to the user's first org
  GET  /auth/me          user + orgs list + active org
  POST /auth/switch-org  re-issues JWT bound to another membership

Every login flow now auto-provisions a personal Organization for new users
and a single `owner` membership, so downstream queries always resolve a
tenant scope via `require_membership`.
"""
import re
import secrets
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_USER_ID,
    TenantScope,
    create_access_token,
    hash_password,
    require_membership,
    require_user,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.models import Organization, OrganizationMembership, User
from app.schemas import LoginBody, Token, UserCreate, UserOut


router = APIRouter(prefix="/auth", tags=["auth"])


def _constant_time_compare(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "workspace"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    suffix = 2
    while True:
        r = await db.execute(select(Organization.id).where(Organization.slug == slug))
        if not r.scalar_one_or_none():
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


async def _primary_membership(
    db: AsyncSession, user_id: str
) -> OrganizationMembership | None:
    r = await db.execute(
        select(OrganizationMembership)
        .where(OrganizationMembership.user_id == user_id)
        .order_by(OrganizationMembership.created_at.asc())
        .limit(1)
    )
    return r.scalar_one_or_none()


async def _ensure_personal_org(
    db: AsyncSession, user: User
) -> OrganizationMembership:
    """Create a personal organization for `user` if they have no memberships."""
    existing = await _primary_membership(db, user.id)
    if existing:
        return existing

    local = (user.email or "").split("@", 1)[0] or user.id[:8]
    slug = await _unique_slug(db, _slugify(local) or f"ws-{user.id[:8]}")
    org = Organization(
        id=str(uuid4()),
        name=f"{local}'s workspace",
        slug=slug,
        created_by=user.id,
    )
    db.add(org)
    membership = OrganizationMembership(
        id=str(uuid4()),
        organization_id=org.id,
        user_id=user.id,
        role="owner",
    )
    db.add(membership)
    if not user.organization_id:
        user.organization_id = org.id
    await db.flush()
    return membership


async def _list_user_orgs(db: AsyncSession, user_id: str) -> list[dict]:
    r = await db.execute(
        select(OrganizationMembership, Organization)
        .join(Organization, Organization.id == OrganizationMembership.organization_id)
        .where(OrganizationMembership.user_id == user_id)
        .order_by(OrganizationMembership.created_at.asc())
    )
    return [
        {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "role": m.role,
        }
        for m, org in r.all()
    ]


def _token_response(user: User, membership: OrganizationMembership, orgs: list[dict]) -> dict:
    token = create_access_token(data={"sub": user.id}, org_id=membership.organization_id)
    user_out = UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        organization_id=membership.organization_id,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_out.model_dump(),
        "organizations": orgs,
        "active_organization_id": membership.organization_id,
    }


@router.post("/register")
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    if get_settings().enable_login:
        raise HTTPException(403, "Registration is disabled when login is required")
    r = await db.execute(select(User).where(User.email == body.email))
    if r.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    user = User(
        id=str(uuid4()),
        email=body.email,
        hashed_password=hash_password(body.password),
        organization_id=None,
        role="user",
    )
    db.add(user)
    await db.flush()

    membership = await _ensure_personal_org(db, user)
    await db.commit()
    await db.refresh(user)

    orgs = await _list_user_orgs(db, user.id)
    return _token_response(user, membership, orgs)


@router.post("/login")
async def login(body: LoginBody, db: AsyncSession = Depends(get_db)):
    settings = get_settings()

    if settings.enable_login:
        username = (body.username or "").strip()
        password = (body.password or "").strip()
        if not username or not password:
            raise HTTPException(400, "Username and password required")
        if not settings.admin_username or not settings.admin_password:
            raise HTTPException(
                500,
                "ADMIN_USERNAME and ADMIN_PASSWORD must be set in backend/.env when ENABLE_LOGIN=true",
            )
        if not _constant_time_compare(username, settings.admin_username) or not _constant_time_compare(
            password, settings.admin_password
        ):
            raise HTTPException(401, "Invalid username or password")
        r = await db.execute(select(User).where(User.id == ADMIN_USER_ID))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(500, "Admin user not initialized")
    else:
        if not body.email or not body.password:
            raise HTTPException(400, "Email and password required")
        r = await db.execute(select(User).where(User.email == body.email))
        user = r.scalar_one_or_none()
        if not user or not verify_password(body.password, user.hashed_password):
            raise HTTPException(401, "Invalid email or password")

    membership = await _ensure_personal_org(db, user)
    await db.commit()
    orgs = await _list_user_orgs(db, user.id)
    return _token_response(user, membership, orgs)


@router.get("/me")
async def me(
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    orgs = await _list_user_orgs(db, scope.user.id)
    return {
        "user": {
            "id": scope.user.id,
            "email": scope.user.email,
            "role": scope.user.role,
            "organization_id": scope.organization_id,
        },
        "organizations": orgs,
        "active_organization_id": scope.organization_id,
        "active_role": scope.role,
    }


class SwitchOrgBody(BaseModel):
    organization_id: str


@router.post("/switch-org")
async def switch_org(
    body: SwitchOrgBody,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-issue a JWT bound to a different organization.

    The caller must already have a membership in the target organization.
    """
    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.organization_id == body.organization_id,
        )
    )
    membership = r.scalar_one_or_none()
    if not membership:
        raise HTTPException(403, "No membership for that organization")

    user.organization_id = membership.organization_id
    user.updated_at = datetime.utcnow()
    await db.commit()

    orgs = await _list_user_orgs(db, user.id)
    return _token_response(user, membership, orgs)
