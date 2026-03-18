"""
Shopify store discovery and connection testing.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/shopify", tags=["shopify"])


@router.post("/test-connection")
async def test_connection(body: dict, user: User = Depends(require_user)):
    """Test Shopify API connection with the provided store name and access token."""
    store = body.get("store", "")
    access_token = body.get("accessToken", "")
    if not store or not access_token:
        raise HTTPException(400, "store and accessToken are required")

    from app.scripts.ask_shopify import _test_connection_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _test_connection_sync(store, access_token))
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")
    return result


@router.post("/discover")
async def discover_objects(body: dict, user: User = Depends(require_user)):
    """Discover available Shopify resources and their counts."""
    store = body.get("store", "")
    access_token = body.get("accessToken", "")
    if not store or not access_token:
        raise HTTPException(400, "store and accessToken are required")

    from app.scripts.ask_shopify import _discover_objects_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_objects_sync(store, access_token))
    except Exception as e:
        raise HTTPException(400, f"Discovery failed: {e}")
    return _sanitize_for_json(result)


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user),
):
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "shopify":
        raise HTTPException(400, "Source is not Shopify")

    meta = dict(source.metadata_ or {})
    store = meta.get("store", "")
    access_token = meta.get("accessToken", "")
    if not store or not access_token:
        raise HTTPException(400, "Source missing store or accessToken")

    from app.scripts.ask_shopify import _discover_objects_sync, REPORT_TEMPLATES
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_objects_sync(store, access_token))
    except Exception as e:
        raise HTTPException(400, f"Refresh failed: {e}")

    meta["resourceCounts"] = result.get("resourceCounts", {})
    meta["report_templates"] = REPORT_TEMPLATES
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
