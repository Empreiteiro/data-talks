"""
Pipedrive CRM discovery and connection testing.
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

router = APIRouter(prefix="/pipedrive", tags=["pipedrive"])


@router.post("/test-connection")
async def test_connection(body: dict, scope: TenantScope = Depends(require_membership)):
    """Test Pipedrive API connection."""
    api_token = body.get("apiToken", "")
    if not api_token:
        raise HTTPException(400, "apiToken is required")

    from app.scripts.ask_pipedrive import _test_connection_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _test_connection_sync(api_token))
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")
    return result


@router.post("/discover")
async def discover_resources(body: dict, scope: TenantScope = Depends(require_membership)):
    """Discover available Pipedrive resources and their counts."""
    api_token = body.get("apiToken", "")
    if not api_token:
        raise HTTPException(400, "apiToken is required")

    from app.scripts.ask_pipedrive import _discover_resources_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_resources_sync(api_token))
    except Exception as e:
        raise HTTPException(400, f"Discovery failed: {e}")
    return _sanitize_for_json(result)


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str, db: AsyncSession = Depends(get_db), scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "pipedrive":
        raise HTTPException(400, "Source is not Pipedrive")

    meta = dict(source.metadata_ or {})
    api_token = meta.get("apiToken", "")
    if not api_token:
        raise HTTPException(400, "Source missing apiToken")

    from app.scripts.ask_pipedrive import _discover_resources_sync, REPORT_TEMPLATES
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, lambda: _discover_resources_sync(api_token))
    except Exception as e:
        raise HTTPException(400, f"Refresh failed: {e}")

    meta["resourceCounts"] = result.get("resourceCounts", {})
    meta["report_templates"] = REPORT_TEMPLATES
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
