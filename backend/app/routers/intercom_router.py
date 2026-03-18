"""
Intercom integration: test connection, discover resources, refresh metadata.
- Test connection (validate access token via GET /me)
- Discover resources (list available Intercom tables and counts)
- Refresh source metadata (schema + preview)
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/intercom", tags=["intercom"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test an Intercom access token. Body: { "accessToken": "..." }."""
    token = body.get("accessToken")
    if not token:
        raise HTTPException(400, "accessToken is required")

    from app.scripts.ask_intercom import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        me = await loop.run_in_executor(None, lambda: _test_connection_sync(token))
        return {"ok": True, "app": me.get("app", {}).get("name", ""), "admin": me.get("name", "")}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/discover")
async def discover_resources(
    body: dict,
    user: User = Depends(require_user),
):
    """Discover available Intercom resources. Body: { "accessToken": "..." }."""
    token = body.get("accessToken")
    if not token:
        raise HTTPException(400, "accessToken is required")

    from app.scripts.ask_intercom import _discover_resources_sync

    loop = asyncio.get_event_loop()
    try:
        resources = await loop.run_in_executor(
            None, lambda: _discover_resources_sync(token)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"resources": resources}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch Intercom resource schemas and preview data, update source metadata."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "intercom":
        raise HTTPException(400, "Source is not Intercom")

    meta = dict(source.metadata_ or {})
    token = meta.get("accessToken")

    if not token:
        raise HTTPException(400, "Source missing accessToken")

    from app.scripts.ask_intercom import (
        _fetch_contacts_sync,
        _fetch_companies_sync,
        _fetch_conversations_sync,
        _fetch_tags_sync,
        _fetch_teams_sync,
        _fetch_admins_sync,
        _fetch_articles_sync,
        _flatten,
        _records_to_columns,
        INTERCOM_TABLES,
    )

    selected = meta.get("selectedResources") or INTERCOM_TABLES
    loop = asyncio.get_event_loop()

    fetchers = {
        "contacts": lambda: _fetch_contacts_sync(token),
        "companies": lambda: _fetch_companies_sync(token),
        "conversations": lambda: _fetch_conversations_sync(token),
        "tags": lambda: _fetch_tags_sync(token),
        "teams": lambda: _fetch_teams_sync(token),
        "admins": lambda: _fetch_admins_sync(token),
        "articles": lambda: _fetch_articles_sync(token),
    }

    table_infos: list[dict] = []
    preview_data: dict[str, list[dict]] = {}

    for resource in selected:
        if resource == "conversation_parts":
            continue
        if resource not in fetchers:
            continue
        try:
            data = await loop.run_in_executor(None, fetchers[resource])
            columns = _records_to_columns(data[:100]) if data else []
            table_infos.append({
                "table": resource,
                "columns": columns,
                "row_count": len(data),
            })
            preview_data[resource] = [_flatten(r) for r in data[:5]]
        except Exception:
            table_infos.append({
                "table": resource,
                "columns": [],
                "row_count": 0,
            })

    meta["table_infos"] = table_infos
    meta["preview"] = preview_data
    meta["schema"] = {"tables": [ti["table"] for ti in table_infos]}
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
