"""
GitHub Analytics discovery and source metadata refresh.
- Test connection (validate PAT + repo access)
- Discover resources (repo stats, available tables)
- Refresh source metadata (fetch table data + preview rows)
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/github-analytics", tags=["github_analytics"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test a GitHub token and repo access. Body: { "token": "...", "owner": "...", "repo": "..." }."""
    token = body.get("token")
    owner = body.get("owner")
    repo = body.get("repo")
    if not token:
        raise HTTPException(400, "token is required")
    if not owner or not repo:
        raise HTTPException(400, "owner and repo are required")

    from app.scripts.ask_github_analytics import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        repo_data = await loop.run_in_executor(
            None, lambda: _test_connection_sync(token, owner, repo)
        )
        return {"ok": True, "repoName": repo_data.get("full_name", "")}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/discover")
async def discover_resources(
    body: dict,
    user: User = Depends(require_user),
):
    """Discover GitHub repo resources. Body: { "token": "...", "owner": "...", "repo": "..." }."""
    token = body.get("token")
    owner = body.get("owner")
    repo = body.get("repo")
    if not token:
        raise HTTPException(400, "token is required")
    if not owner or not repo:
        raise HTTPException(400, "owner and repo are required")

    from app.scripts.ask_github_analytics import _discover_resources_sync

    loop = asyncio.get_event_loop()
    try:
        resources = await loop.run_in_executor(
            None, lambda: _discover_resources_sync(token, owner, repo)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return resources


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch GitHub data and update source metadata with schema and preview."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "github_analytics":
        raise HTTPException(400, "Source is not GitHub Analytics")

    meta = dict(source.metadata_ or {})
    token = meta.get("token")
    owner = meta.get("owner")
    repo = meta.get("repo")

    if not token or not owner or not repo:
        raise HTTPException(400, "Source missing token, owner, or repo")

    from app.scripts.ask_github_analytics import (
        _fetch_all_tables_sync,
        _tables_to_sqlite,
        _get_schema_text,
    )

    loop = asyncio.get_event_loop()
    try:
        tables_data = await loop.run_in_executor(
            None, lambda: _fetch_all_tables_sync(token, owner, repo)
        )
        db_path = await loop.run_in_executor(
            None, lambda: _tables_to_sqlite(tables_data)
        )
        schema_text = await loop.run_in_executor(
            None, lambda: _get_schema_text(db_path)
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        try:
            import os
            os.unlink(db_path)
        except Exception:
            pass

    # Build preview from first 5 rows of each table
    preview = {}
    table_infos = []
    for table_name, rows in tables_data.items():
        preview[table_name] = rows[:5]
        columns = list(rows[0].keys()) if rows else []
        table_infos.append({
            "table": table_name,
            "row_count": len(rows),
            "columns": columns,
        })

    meta["schema_text"] = schema_text
    meta["preview"] = _sanitize_for_json(preview)
    meta["table_infos"] = _sanitize_for_json(table_infos)
    meta["schema"] = {"tables": [ti["table"] for ti in table_infos]}
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
