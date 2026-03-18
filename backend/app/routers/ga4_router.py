"""
Google Analytics 4 (GA4) router: test connection, discover tables, refresh metadata.
"""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db, AsyncSessionLocal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/ga4", tags=["ga4"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test GA4 connection by running a minimal report.
    Body: { "credentialsContent": "...", "propertyId": "..." }
    """
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    property_id = body.get("propertyId") or body.get("property_id")

    if not credentials_content:
        raise HTTPException(400, "credentialsContent is required")
    if not property_id:
        raise HTTPException(400, "propertyId is required")

    from app.scripts.ask_ga4 import _get_access_token, _test_connection_sync

    try:
        sa = json.loads(credentials_content)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON in credentialsContent")

    try:
        access_token = await _get_access_token(sa)
    except Exception as e:
        raise HTTPException(400, f"Authentication failed: {e}")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, lambda: _test_connection_sync(access_token, property_id)
        )
    except Exception as e:
        raise HTTPException(400, f"Connection test failed: {e}")

    return result


@router.post("/discover")
async def discover_tables(
    body: dict,
    user: User = Depends(require_user),
):
    """Discover GA4 tables (fetch sample data for each).
    Body: { "credentialsContent": "...", "propertyId": "...", "tables": [...] (optional) }
    """
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    property_id = body.get("propertyId") or body.get("property_id")
    tables = body.get("tables")

    if not credentials_content:
        raise HTTPException(400, "credentialsContent is required")
    if not property_id:
        raise HTTPException(400, "propertyId is required")

    from app.scripts.ask_ga4 import discover_ga4

    try:
        table_infos = await discover_ga4(credentials_content, property_id, tables)
    except Exception as e:
        raise HTTPException(400, f"Discovery failed: {e}")

    return {"table_infos": table_infos}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Refresh GA4 source metadata (re-fetch table schemas and preview data)."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "ga4":
        raise HTTPException(400, "Source is not GA4")

    meta = dict(source.metadata_ or {})
    creds = meta.get("credentialsContent") or meta.get("credentials_content")
    if not creds:
        raise HTTPException(400, "Source has no credentials")

    property_id = meta.get("propertyId") or meta.get("property_id")
    if not property_id:
        raise HTTPException(400, "Source has no propertyId")

    tables = meta.get("tables")

    from app.scripts.ask_ga4 import discover_ga4

    try:
        table_infos = await discover_ga4(creds, property_id, tables)
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["table_infos"] = table_infos
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
