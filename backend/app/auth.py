"""JWT authentication + multi-tenant scope resolution.

Tenant scope resolution order, used by `require_membership`:
  1. `X-API-Key` header → ApiKey.organization_id + caller's role in that org
  2. `Authorization: Bearer <jwt>` with `org_id` claim → claim's org + membership role
  3. `ENABLE_LOGIN=false` (guest mode) → guest user's Guest-org membership

Any resolution must produce an `OrganizationMembership` row for the caller;
otherwise we raise 403. The resolved `TenantScope` dataclass is the single
object routers pass around — never trust `User.organization_id` directly,
it is only a "last active org" hint kept for UI convenience.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import ROLE_HIERARCHY, Organization, OrganizationMembership, User

# Fixed IDs for single-user modes (no login = guest, login = admin)
GUEST_USER_ID = "00000000-0000-0000-0000-000000000001"
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000002"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{get_settings().api_prefix}/auth/login", auto_error=False)
http_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    # bcrypt rejects empty string and accepts at most 72 bytes on some platforms
    if not password:
        password = "unused"
    raw = password.encode("utf-8")
    if len(raw) > 72:
        password = raw[:72].decode("utf-8", errors="ignore") or "unused"
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, *, org_id: str | None = None) -> str:
    """Issue a JWT. `data` typically carries `sub` (user id); `org_id` is written
    as a top-level claim naming the active organization for this token."""
    settings = get_settings()
    to_encode = data.copy()
    if org_id is not None:
        to_encode["org_id"] = org_id
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict | None:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    cred: HTTPAuthorizationCredentials | None = Depends(http_bearer),
) -> User | None:
    settings = get_settings()
    if cred and cred.credentials:
        payload = decode_token(cred.credentials)
        if payload and "sub" in payload:
            result = await db.execute(select(User).where(User.id == payload["sub"]))
            user = result.scalar_one_or_none()
            if user:
                return user
    # When login is disabled, treat missing/invalid token as guest user
    if not settings.enable_login:
        result = await db.execute(select(User).where(User.id == GUEST_USER_ID))
        guest = result.scalar_one_or_none()
        if guest:
            return guest
        # Create guest on demand if missing (e.g. DB existed before guest was added)
        guest = User(
            id=GUEST_USER_ID,
            email="guest@local",
            hashed_password=hash_password("guest-no-login"),
            organization_id=GUEST_USER_ID,
            role="user",
        )
        db.add(guest)
        await db.commit()
        await db.refresh(guest)
        return guest
    return None


async def require_user(
    request: Request,
    user: User | None = Depends(get_current_user),
) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    # Expose user info for audit middleware
    request.state.audit_user_id = user.id
    request.state.audit_user_email = user.email
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    """Require current user to have admin role (super user)."""
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# API Key authentication (for public /api/v1/* endpoints)
# ---------------------------------------------------------------------------
import hashlib
from fastapi import Header
from app.models import ApiKey


def _hash_api_key(raw_key: str) -> str:
    """Compute SHA-256 hash of the raw API key."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def get_api_key_user(
    x_api_key: str = Header(..., alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, ApiKey]:
    """Validate X-API-Key header and return (user, api_key_row).

    Raises 401 if the key is invalid or inactive.
    Updates last_used_at on every successful call.
    """
    key_hash = _hash_api_key(x_api_key)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or inactive API key")

    result = await db.execute(select(User).where(User.id == api_key.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key owner not found")

    api_key.last_used_at = datetime.utcnow()
    await db.flush()

    return user, api_key


# ---------------------------------------------------------------------------
# Tenant scope resolution
# ---------------------------------------------------------------------------


@dataclass
class TenantScope:
    """The resolved active organization + role for the current request.

    Use `scope.organization_id` in every query that targets a tenant-scoped
    model (`Source`, `Agent`, `PipelineRun`, …) via the `tenant_filter`
    helper in `app.services.tenant_scope`.
    """

    user: User
    organization_id: str
    role: str  # "viewer" | "member" | "admin" | "owner"


def _role_level(role: str | None) -> int:
    return ROLE_HIERARCHY.get(role or "", -1)


async def _membership_for(
    db: AsyncSession, *, user_id: str, organization_id: str
) -> OrganizationMembership | None:
    r = await db.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
        )
    )
    return r.scalar_one_or_none()


async def _first_membership(db: AsyncSession, user_id: str) -> OrganizationMembership | None:
    r = await db.execute(
        select(OrganizationMembership)
        .where(OrganizationMembership.user_id == user_id)
        .order_by(OrganizationMembership.created_at.asc())
        .limit(1)
    )
    return r.scalar_one_or_none()


async def require_membership(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TenantScope:
    """Resolve the active organization for the caller and return a TenantScope.

    Order:
      1. X-API-Key → scope is the key's organization_id, role is the owner's
         membership role in that org.
      2. Bearer JWT → scope is the `org_id` claim's org; role is the caller's
         membership there. If the claim is absent we fall back to the user's
         first membership (stable ordering by created_at asc).
      3. Guest mode (`ENABLE_LOGIN=false`) → guest user's single membership.

    Raises 401 if unauthenticated, 403 if the caller has no membership for
    the claimed org.
    """
    from app.models import ApiKey  # local import to avoid circular at module load

    settings = get_settings()

    # --- 1. API key takes precedence -----------------------------------------
    api_key_header = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if api_key_header:
        r = await db.execute(
            select(ApiKey).where(
                ApiKey.key_hash == _hash_api_key(api_key_header),
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        key = r.scalar_one_or_none()
        if not key:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or inactive API key")
        r2 = await db.execute(select(User).where(User.id == key.user_id))
        user = r2.scalar_one_or_none()
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API key owner not found")
        key.last_used_at = datetime.utcnow()
        await db.flush()

        membership = await _membership_for(
            db, user_id=user.id, organization_id=key.organization_id
        )
        if not membership:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "API key owner has no membership in the key's organization",
            )
        request.state.audit_user_id = user.id
        request.state.audit_user_email = user.email
        request.state.audit_org_id = key.organization_id
        return TenantScope(user=user, organization_id=key.organization_id, role=membership.role)

    # --- 2. Bearer JWT --------------------------------------------------------
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        payload = decode_token(token) or {}
        sub = payload.get("sub")
        claimed_org = payload.get("org_id")
        if not sub:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        r = await db.execute(select(User).where(User.id == sub))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

        if claimed_org:
            membership = await _membership_for(db, user_id=user.id, organization_id=claimed_org)
            if not membership:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "No membership for the token's organization"
                )
        else:
            # Older tokens issued before `org_id` claim existed — fall back to
            # the user's primary membership. After expiry, all tokens carry it.
            membership = await _first_membership(db, user.id)
            if not membership:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "User has no organization memberships"
                )

        request.state.audit_user_id = user.id
        request.state.audit_user_email = user.email
        request.state.audit_org_id = membership.organization_id
        return TenantScope(
            user=user, organization_id=membership.organization_id, role=membership.role
        )

    # --- 3. Guest fallback ----------------------------------------------------
    if not settings.enable_login:
        r = await db.execute(select(User).where(User.id == GUEST_USER_ID))
        guest = r.scalar_one_or_none()
        if not guest:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "Guest user missing; run migrations"
            )
        membership = await _first_membership(db, guest.id)
        if not membership:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Guest user has no membership; run migrations",
            )
        request.state.audit_user_id = guest.id
        request.state.audit_user_email = guest.email
        request.state.audit_org_id = membership.organization_id
        return TenantScope(
            user=guest, organization_id=membership.organization_id, role=membership.role
        )

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


def require_role(minimum: str):
    """Dependency factory: enforces `role >= minimum` for the resolved scope.

    Usage:
        scope: TenantScope = Depends(require_role("admin"))
    """
    min_level = _role_level(minimum)
    if min_level < 0:
        raise ValueError(f"Unknown role: {minimum}")

    async def _dep(scope: TenantScope = Depends(require_membership)) -> TenantScope:
        if _role_level(scope.role) < min_level:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This action requires role '{minimum}' or higher",
            )
        return scope

    return _dep
