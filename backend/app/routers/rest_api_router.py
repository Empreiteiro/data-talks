"""
REST API discovery and source metadata refresh.
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

router = APIRouter(prefix="/rest-api", tags=["rest-api"])


@router.post("/test")
async def test_request(body: dict, scope: TenantScope = Depends(require_membership)):
    """Execute a test API request and return preview. Body: { url, method, headers, queryParams, body, dataPath }."""
    url = body.get("url", "")
    if not url:
        raise HTTPException(400, "url is required")

    from app.scripts.ask_rest_api import _test_request_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _test_request_sync(
                url=url,
                method=body.get("method", "GET"),
                headers=body.get("headers"),
                query_params=body.get("queryParams"),
                body=body.get("body"),
                data_path=body.get("dataPath"),
            ),
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    return _sanitize_for_json(result)


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str, db: AsyncSession = Depends(get_db), scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "rest_api":
        raise HTTPException(400, "Source is not REST API")

    meta = dict(source.metadata_ or {})
    url = meta.get("url", "")
    if not url:
        raise HTTPException(400, "Source missing url")

    from app.scripts.ask_rest_api import _test_request_sync
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _test_request_sync(
                url=url,
                method=meta.get("method", "GET"),
                headers=meta.get("headers"),
                query_params=meta.get("queryParams"),
                body=meta.get("body"),
                data_path=meta.get("dataPath"),
            ),
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["columns"] = result.get("columns", [])
    meta["preview"] = result.get("preview", [])
    meta["rowCount"] = result.get("rowCount", 0)
    meta["schema"] = {"columns": result.get("columns", [])}
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
