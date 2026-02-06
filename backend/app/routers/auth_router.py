from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.auth import hash_password, verify_password, create_access_token, require_user
from app.schemas import UserCreate, UserLogin, Token, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
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
    return Token(access_token=token, user=UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id))


@router.post("/login")
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(User).where(User.email == body.email))
    user = r.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(data={"sub": user.id})
    return Token(access_token=token, user=UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)):
    return UserOut(id=user.id, email=user.email, role=user.role, organization_id=user.organization_id)
