"""JWT authentication (replaces Supabase Auth). Optional login via ENABLE_LOGIN."""
from datetime import datetime, timedelta
from uuid import uuid4
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User

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


def create_access_token(data: dict) -> str:
    settings = get_settings()
    to_encode = data.copy()
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


async def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
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
