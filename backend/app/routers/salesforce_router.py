"""
Salesforce CRM discovery and connection testing.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/salesforce", tags=["salesforce"])


@router.post("/test-connection")
async def test_connection(body: dict, user: User = Depends(require_user)):
    """Test Salesforce API connection with the provided access token and instance URL."""
    access_token = body.get("accessToken", "")
    instance_url = body.get("instanceUrl", "")
    if not access_token:
        raise HTTPException(400, "accessToken is required")
    if not instance_url:
        raise HTTPException(400, "instanceUrl is required")

    # Normalize instance URL (remove trailing slash)
    instance_url = instance_url.rstrip("/")

    from app.scripts.ask_salesforce import _test_connection_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _test_connection_sync(access_token, instance_url))
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")
    return result


@router.post("/discover")
async def discover_objects(body: dict, user: User = Depends(require_user)):
    """Discover available Salesforce CRM objects and their counts."""
    access_token = body.get("accessToken", "")
    instance_url = body.get("instanceUrl", "")
    if not access_token:
        raise HTTPException(400, "accessToken is required")
    if not instance_url:
        raise HTTPException(400, "instanceUrl is required")

    instance_url = instance_url.rstrip("/")

    from app.scripts.ask_salesforce import _discover_objects_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_objects_sync(access_token, instance_url))
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
    if source.type != "salesforce":
        raise HTTPException(400, "Source is not Salesforce")

    meta = dict(source.metadata_ or {})
    access_token = meta.get("accessToken", "")
    instance_url = meta.get("instanceUrl", "")
    if not access_token or not instance_url:
        raise HTTPException(400, "Source missing accessToken or instanceUrl")

    instance_url = instance_url.rstrip("/")

    from app.scripts.ask_salesforce import _discover_objects_sync, REPORT_TEMPLATES
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_objects_sync(access_token, instance_url))
    except Exception as e:
        raise HTTPException(400, f"Refresh failed: {e}")

    meta["objectCounts"] = result.get("objectCounts", {})
    meta["report_templates"] = REPORT_TEMPLATES
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
