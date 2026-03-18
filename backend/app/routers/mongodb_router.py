"""
MongoDB discovery and source metadata refresh.
- Test connection
- List databases
- List collections in a database
- Refresh source metadata (schema + preview)
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db, AsyncSessionLocal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/mongodb", tags=["mongodb"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test a MongoDB connection string. Body: { "connectionString": "..." }."""
    connection_string = body.get("connectionString")
    if not connection_string:
        raise HTTPException(400, "connectionString is required")

    from app.scripts.ask_mongodb import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        ok = await loop.run_in_executor(
            None, lambda: _test_connection_sync(connection_string)
        )
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/databases")
async def list_databases(
    body: dict,
    user: User = Depends(require_user),
):
    """List available MongoDB databases. Body: { "connectionString": "..." }."""
    connection_string = body.get("connectionString")
    if not connection_string:
        raise HTTPException(400, "connectionString is required")

    from app.scripts.ask_mongodb import _list_databases_sync

    loop = asyncio.get_event_loop()
    try:
        databases = await loop.run_in_executor(
            None, lambda: _list_databases_sync(connection_string)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"databases": [{"id": d, "name": d} for d in databases]}


@router.post("/collections")
async def list_collections(
    body: dict,
    user: User = Depends(require_user),
):
    """List collections in a MongoDB database. Body: { "connectionString": "...", "database": "..." }."""
    connection_string = body.get("connectionString")
    database = body.get("database")
    if not connection_string or not database:
        raise HTTPException(400, "connectionString and database are required")

    from app.scripts.ask_mongodb import _list_collections_sync

    loop = asyncio.get_event_loop()
    try:
        collections = await loop.run_in_executor(
            None, lambda: _list_collections_sync(connection_string, database)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"collections": [{"id": c, "name": c} for c in collections]}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch MongoDB collection schema (fields + preview) and update source metadata."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "mongodb":
        raise HTTPException(400, "Source is not MongoDB")

    meta = dict(source.metadata_ or {})
    connection_string = meta.get("connectionString")
    database = meta.get("database")
    collection = meta.get("collection")

    if not connection_string or not database or not collection:
        raise HTTPException(400, "Source missing connectionString, database, or collection")

    from app.scripts.ask_mongodb import _fetch_schema_sync

    loop = asyncio.get_event_loop()
    try:
        schema_data = await loop.run_in_executor(
            None,
            lambda: _fetch_schema_sync(connection_string, database, collection),
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["schema"] = {"fields": schema_data["fields"]}
    meta["preview"] = schema_data["preview"]
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
