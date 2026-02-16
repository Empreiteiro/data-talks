"""User management API (admin/super user only). Available when ENABLE_LOGIN=true."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.auth import hash_password, require_admin, ADMIN_USER_ID

router = APIRouter(prefix="/users", tags=["users"])


class UserCreateAdmin(BaseModel):
    """Schema for admin creating a new user."""
    email: EmailStr
    password: str
    role: str = "user"


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users. Admin only. Available when ENABLE_LOGIN=true."""
    if not get_settings().enable_login:
        raise HTTPException(404, "User management requires ENABLE_LOGIN=true")
    r = await db.execute(select(User).order_by(User.created_at.desc()))
    users = r.scalars().all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "role": u.role,
            "createdAt": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("")
async def create_user(
    body: UserCreateAdmin,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create a new user. Admin (super user) only. Available when ENABLE_LOGIN=true."""
    if not get_settings().enable_login:
        raise HTTPException(404, "User management requires ENABLE_LOGIN=true")
    role = (body.role or "user").strip().lower()
    if role not in ("user", "admin"):
        role = "user"
    r = await db.execute(select(User).where(User.email == body.email))
    if r.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user_id = str(uuid4())
    user = User(
        id=user_id,
        email=body.email,
        hashed_password=hash_password(body.password),
        organization_id=admin.organization_id or ADMIN_USER_ID,
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
    }
