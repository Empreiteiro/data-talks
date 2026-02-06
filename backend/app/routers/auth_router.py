from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import secrets

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.auth import hash_password, verify_password, create_access_token, require_user, ADMIN_USER_ID
from app.schemas import UserCreate, LoginBody, Token, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _constant_time_compare(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


@router.post("/register")
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    if get_settings().enable_login:
        raise HTTPException(403, "Registration is disabled when login is required")
    r = await db.execute(select(User).where(User.email == body.email))
    if r.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user_id = str(uuid4())
    org_id = str(uuid4())
    user = User(
        id=user_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        organization_id=org_id,
        role="user",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(data={"sub": user.id})
    user_out = UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id)
    return Token(access_token=token, user=user_out.model_dump())


@router.post("/login")
async def login(body: LoginBody, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    if settings.enable_login:
        # Admin login: username + password from env (strip input to match env)
        username = (body.username or "").strip()
        password = (body.password or "").strip()
        if not username or not password:
            raise HTTPException(400, "Username and password required")
        if not settings.admin_username or not settings.admin_password:
            raise HTTPException(500, "ADMIN_USERNAME and ADMIN_PASSWORD must be set in backend/.env when ENABLE_LOGIN=true")
        if not _constant_time_compare(username, settings.admin_username) or not _constant_time_compare(password, settings.admin_password):
            raise HTTPException(401, "Invalid username or password")
        r = await db.execute(select(User).where(User.id == ADMIN_USER_ID))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(500, "Admin user not initialized")
        token = create_access_token(data={"sub": user.id})
        user_out = UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id)
        return Token(access_token=token, user=user_out.model_dump())
    # Email + password (when login not required)
    if not body.email or not body.password:
        raise HTTPException(400, "Email and password required")
    r = await db.execute(select(User).where(User.email == body.email))
    user = r.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(data={"sub": user.id})
    user_out = UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id)
    return Token(access_token=token, user=user_out.model_dump())


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)):
    return UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id)
