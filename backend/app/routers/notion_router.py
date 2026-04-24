"""
Notion Database discovery and source metadata refresh.
- Test connection (validate integration token)
- List accessible databases
- Refresh source metadata (properties + preview rows)
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

router = APIRouter(prefix="/notion", tags=["notion"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    scope: TenantScope = Depends(require_membership),
):
    """Test a Notion integration token. Body: { "integrationToken": "..." }."""
    token = body.get("integrationToken")
    if not token:
        raise HTTPException(400, "integrationToken is required")

    from app.scripts.ask_notion import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        ok = await loop.run_in_executor(None, lambda: _test_connection_sync(token))
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/databases")
async def list_databases(
    body: dict,
    scope: TenantScope = Depends(require_membership),
):
    """List accessible Notion databases. Body: { "integrationToken": "..." }."""
    token = body.get("integrationToken")
    if not token:
        raise HTTPException(400, "integrationToken is required")

    from app.scripts.ask_notion import _list_databases_sync

    loop = asyncio.get_event_loop()
    try:
        databases = await loop.run_in_executor(
            None, lambda: _list_databases_sync(token)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"databases": [{"id": db["id"], "name": db["title"]} for db in databases]}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Fetch Notion database properties and preview rows, update source metadata."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "notion":
        raise HTTPException(400, "Source is not Notion")

    meta = dict(source.metadata_ or {})
    token = meta.get("integrationToken")
    database_id = meta.get("databaseId")

    if not token or not database_id:
        raise HTTPException(400, "Source missing integrationToken or databaseId")

    from app.scripts.ask_notion import (
        _get_database_properties_sync,
        _query_database_sync,
        _pages_to_rows,
    )

    loop = asyncio.get_event_loop()
    try:
        properties = await loop.run_in_executor(
            None,
            lambda: _get_database_properties_sync(token, database_id),
        )
        pages = await loop.run_in_executor(
            None,
            lambda: _query_database_sync(token, database_id, max_pages=50),
        )
        rows = _pages_to_rows(pages)
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["properties"] = properties
    meta["preview"] = rows[:5]
    meta["rowCount"] = len(rows)
    meta["schema"] = {"columns": [p["name"] for p in properties]}
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
