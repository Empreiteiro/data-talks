"""
Snowflake discovery and source metadata refresh.
- Test connection
- List warehouses, databases, schemas, tables
- Refresh source metadata (table_infos with columns and preview)
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/snowflake", tags=["snowflake"])


def _extract_creds(body: dict) -> tuple[str, str, str]:
    account = body.get("account", "")
    user = body.get("user", "")
    password = body.get("password", "")
    if not account or not user or not password:
        raise HTTPException(400, "account, user, and password are required")
    return account, user, password


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test Snowflake credentials."""
    account, sf_user, password = _extract_creds(body)

    from app.scripts.ask_snowflake import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        ok = await loop.run_in_executor(
            None, lambda: _test_connection_sync(account, sf_user, password)
        )
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/warehouses")
async def list_warehouses(
    body: dict,
    user: User = Depends(require_user),
):
    """List available Snowflake warehouses."""
    account, sf_user, password = _extract_creds(body)

    from app.scripts.ask_snowflake import _list_warehouses_sync

    loop = asyncio.get_event_loop()
    try:
        warehouses = await loop.run_in_executor(
            None, lambda: _list_warehouses_sync(account, sf_user, password)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"warehouses": [{"id": w, "name": w} for w in warehouses]}


@router.post("/databases")
async def list_databases(
    body: dict,
    user: User = Depends(require_user),
):
    """List available Snowflake databases."""
    account, sf_user, password = _extract_creds(body)

    from app.scripts.ask_snowflake import _list_databases_sync

    loop = asyncio.get_event_loop()
    try:
        databases = await loop.run_in_executor(
            None, lambda: _list_databases_sync(account, sf_user, password)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"databases": [{"id": d, "name": d} for d in databases]}


@router.post("/schemas")
async def list_schemas(
    body: dict,
    user: User = Depends(require_user),
):
    """List schemas in a Snowflake database."""
    account, sf_user, password = _extract_creds(body)
    database = body.get("database", "")
    if not database:
        raise HTTPException(400, "database is required")

    from app.scripts.ask_snowflake import _list_schemas_sync

    loop = asyncio.get_event_loop()
    try:
        schemas = await loop.run_in_executor(
            None, lambda: _list_schemas_sync(account, sf_user, password, database)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"schemas": [{"id": s, "name": s} for s in schemas]}


@router.post("/tables")
async def list_tables(
    body: dict,
    user: User = Depends(require_user),
):
    """List tables in a Snowflake schema."""
    account, sf_user, password = _extract_creds(body)
    database = body.get("database", "")
    schema = body.get("schema", "")
    if not database or not schema:
        raise HTTPException(400, "database and schema are required")

    from app.scripts.ask_snowflake import _list_tables_sync

    loop = asyncio.get_event_loop()
    try:
        tables = await loop.run_in_executor(
            None, lambda: _list_tables_sync(account, sf_user, password, database, schema)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"tables": [{"id": t, "name": t} for t in tables]}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch Snowflake table schema and preview rows and update source metadata."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "snowflake":
        raise HTTPException(400, "Source is not Snowflake")

    meta = dict(source.metadata_ or {})
    account = meta.get("account", "")
    sf_user = meta.get("user", "")
    password = meta.get("password", "")
    warehouse = meta.get("warehouse", "")
    database = meta.get("database", "")
    schema_name = meta.get("schema", "")
    tables = meta.get("tables", [])

    if not account or not sf_user or not password:
        raise HTTPException(400, "Source missing Snowflake credentials")
    if not tables:
        raise HTTPException(400, "Source has no tables configured")

    from app.scripts.ask_snowflake import _fetch_table_infos_sync

    loop = asyncio.get_event_loop()
    try:
        table_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_table_infos_sync(
                account, sf_user, password, warehouse, database, schema_name, tables
            ),
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["table_infos"] = table_infos
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
