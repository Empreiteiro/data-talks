"""
Audit trail API: list, search, filter, export audit logs and manage retention policy.
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.auth import require_user
from app.models import User
from app.audit import (
    list_audit_logs,
    export_audit_csv,
    get_retention_config,
    update_retention_config,
    apply_retention_policy,
)

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    category: str | None = Query(default=None),
    action: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    user: User = Depends(require_user),
):
    """List audit logs with filtering and pagination."""
    return await list_audit_logs(
        limit=limit,
        offset=offset,
        category=category,
        action=action,
        user_id=user_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/export")
async def export_audit_logs(
    category: str | None = Query(default=None),
    action: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    user: User = Depends(require_user),
):
    """Export audit logs as CSV."""
    csv_data = await export_audit_csv(
        category=category,
        action=action,
        user_id=user_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    return StreamingResponse(
        iter([csv_data]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_logs.csv"},
    )


@router.get("/retention")
async def get_retention(user: User = Depends(require_user)):
    """Get current retention policy."""
    return await get_retention_config()


@router.patch("/retention")
async def update_retention(
    body: dict,
    user: User = Depends(require_user),
):
    """Update retention policy (retention_days)."""
    days = body.get("retention_days", 90)
    return await update_retention_config(retention_days=days, user_id=user.id)


@router.post("/retention/apply")
async def trigger_retention(user: User = Depends(require_user)):
    """Manually trigger retention policy cleanup."""
    deleted = await apply_retention_policy()
    return {"deleted": deleted}
