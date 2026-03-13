"""
Audit trail service: records user actions and provides query/export capabilities.
"""
import csv
import io
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, desc, delete, func, and_

from app.database import AsyncSessionLocal
from app.models import AuditLog, AuditRetentionConfig


async def record_audit(
    action: str,
    category: str,
    user_id: str | None = None,
    user_email: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Persist an audit log entry."""
    async with AsyncSessionLocal() as session:
        entry = AuditLog(
            id=str(uuid.uuid4()),
            user_id=user_id,
            user_email=user_email,
            action=action,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_=metadata,
        )
        session.add(entry)
        await session.commit()


async def list_audit_logs(
    limit: int = 50,
    offset: int = 0,
    category: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    """Query audit logs with filtering, pagination, and total count."""
    async with AsyncSessionLocal() as session:
        conditions = []
        if category:
            conditions.append(AuditLog.category == category)
        if action:
            conditions.append(AuditLog.action == action)
        if user_id:
            conditions.append(AuditLog.user_id == user_id)
        if search:
            like = f"%{search}%"
            conditions.append(
                AuditLog.detail.ilike(like)
                | AuditLog.action.ilike(like)
                | AuditLog.user_email.ilike(like)
                | AuditLog.resource_type.ilike(like)
            )
        if date_from:
            conditions.append(AuditLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            dt_to = datetime.fromisoformat(date_to)
            if dt_to.hour == 0 and dt_to.minute == 0:
                dt_to = dt_to + timedelta(days=1)
            conditions.append(AuditLog.created_at < dt_to)

        where = and_(*conditions) if conditions else True

        count_stmt = select(func.count(AuditLog.id)).where(where)
        total = (await session.execute(count_stmt)).scalar() or 0

        stmt = (
            select(AuditLog)
            .where(where)
            .order_by(desc(AuditLog.created_at))
            .offset(offset)
            .limit(limit)
        )
        rows = (await session.execute(stmt)).scalars().all()

        return {
            "total": total,
            "items": [_row_to_dict(r) for r in rows],
        }


async def export_audit_csv(
    category: str | None = None,
    action: str | None = None,
    user_id: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> str:
    """Export filtered audit logs as CSV string."""
    result = await list_audit_logs(
        limit=10000,
        offset=0,
        category=category,
        action=action,
        user_id=user_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "timestamp", "action", "category", "user_email", "resource_type",
        "resource_id", "detail", "ip_address",
    ])
    for item in result["items"]:
        writer.writerow([
            item["created_at"],
            item["action"],
            item["category"],
            item.get("user_email", ""),
            item.get("resource_type", ""),
            item.get("resource_id", ""),
            item.get("detail", ""),
            item.get("ip_address", ""),
        ])
    return output.getvalue()


async def get_retention_config() -> dict[str, Any]:
    """Get the current retention policy."""
    async with AsyncSessionLocal() as session:
        stmt = select(AuditRetentionConfig).limit(1)
        row = (await session.execute(stmt)).scalar_one_or_none()
        if not row:
            return {"retention_days": 90}
        return {
            "retention_days": row.retention_days,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }


async def update_retention_config(retention_days: int, user_id: str | None = None) -> dict[str, Any]:
    """Update the retention policy."""
    async with AsyncSessionLocal() as session:
        stmt = select(AuditRetentionConfig).limit(1)
        row = (await session.execute(stmt)).scalar_one_or_none()
        if row:
            row.retention_days = retention_days
            row.updated_by = user_id
        else:
            row = AuditRetentionConfig(
                id=str(uuid.uuid4()),
                retention_days=retention_days,
                updated_by=user_id,
            )
            session.add(row)
        await session.commit()
        return {"retention_days": row.retention_days}


async def apply_retention_policy() -> int:
    """Delete audit logs older than the retention period. Returns count deleted."""
    config = await get_retention_config()
    days = config["retention_days"]
    if days <= 0:
        return 0
    cutoff = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as session:
        stmt = delete(AuditLog).where(AuditLog.created_at < cutoff)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount


def _row_to_dict(r: AuditLog) -> dict[str, Any]:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "user_email": r.user_email,
        "action": r.action,
        "category": r.category,
        "resource_type": r.resource_type,
        "resource_id": r.resource_id,
        "detail": r.detail,
        "ip_address": r.ip_address,
        "metadata": r.metadata_,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }
