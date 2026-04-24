"""
Stripe discovery and source metadata refresh.
- Test connection (GET /v1/balance)
- Discover resources (fetch sample from each table)
- Refresh source metadata
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/stripe", tags=["stripe"])


@router.post("/test-connection")
async def test_connection(body: dict, scope: TenantScope = Depends(require_membership)):
    """Test Stripe API connection. Body: { "apiKey": "sk_..." }."""
    api_key = body.get("apiKey") or body.get("api_key") or ""
    if not api_key:
        raise HTTPException(400, "apiKey is required")

    from app.scripts.ask_stripe import _test_stripe_connection_sync

    loop = asyncio.get_event_loop()
    try:
        balance = await loop.run_in_executor(None, lambda: _test_stripe_connection_sync(api_key))
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")

    return {"ok": True, "balance": _sanitize_for_json(balance)}


@router.post("/discover")
async def discover_resources(body: dict, scope: TenantScope = Depends(require_membership)):
    """Discover Stripe resources. Body: { "apiKey": "sk_...", "tables": ["customers", ...] }."""
    api_key = body.get("apiKey") or body.get("api_key") or ""
    if not api_key:
        raise HTTPException(400, "apiKey is required")

    tables = body.get("tables") or list(
        ["customers", "subscriptions", "invoices", "charges", "products", "prices", "refunds", "payouts", "disputes"]
    )

    from app.scripts.ask_stripe import _discover_stripe_resources_sync

    loop = asyncio.get_event_loop()
    try:
        resources = await loop.run_in_executor(
            None, lambda: _discover_stripe_resources_sync(api_key, tables)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"resources": _sanitize_for_json(resources)}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Refresh Stripe source metadata (re-discover resources and update sample data)."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "stripe":
        raise HTTPException(400, "Source is not Stripe")

    meta = dict(source.metadata_ or {})
    api_key = meta.get("apiKey") or meta.get("api_key") or ""
    if not api_key:
        raise HTTPException(400, "Source has no API key")

    tables = meta.get("tables") or [
        "customers", "subscriptions", "invoices", "charges",
        "products", "prices", "refunds", "payouts", "disputes",
    ]

    from app.scripts.ask_stripe import _discover_stripe_resources_sync

    loop = asyncio.get_event_loop()
    try:
        resources = await loop.run_in_executor(
            None, lambda: _discover_stripe_resources_sync(api_key, tables)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["table_infos"] = resources
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
