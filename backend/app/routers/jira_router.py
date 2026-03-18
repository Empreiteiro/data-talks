"""
Jira integration: test connection, discover projects/boards, refresh source metadata.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/jira", tags=["jira"])


@router.post("/test-connection")
async def test_connection(
    body: dict,
    user: User = Depends(require_user),
):
    """Test Jira credentials. Body: { "domain": "...", "email": "...", "apiToken": "..." }."""
    domain = body.get("domain")
    email = body.get("email")
    api_token = body.get("apiToken")
    if not domain or not email or not api_token:
        raise HTTPException(400, "domain, email, and apiToken are required")

    from app.scripts.ask_jira import _test_connection_sync

    loop = asyncio.get_event_loop()
    try:
        user_info = await loop.run_in_executor(
            None, lambda: _test_connection_sync(domain, email, api_token)
        )
        return {"ok": True, "displayName": user_info.get("displayName", "")}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/discover")
async def discover(
    body: dict,
    user: User = Depends(require_user),
):
    """Discover Jira projects and boards. Body: { "domain": "...", "email": "...", "apiToken": "..." }."""
    domain = body.get("domain")
    email = body.get("email")
    api_token = body.get("apiToken")
    if not domain or not email or not api_token:
        raise HTTPException(400, "domain, email, and apiToken are required")

    from app.scripts.ask_jira import _discover_sync

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, lambda: _discover_sync(domain, email, api_token)
        )
        return result
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Refresh Jira source metadata: re-discover projects and boards."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "jira":
        raise HTTPException(400, "Source is not Jira")

    meta = dict(source.metadata_ or {})
    domain = meta.get("domain")
    email = meta.get("email")
    api_token = meta.get("apiToken")

    if not domain or not email or not api_token:
        raise HTTPException(400, "Source missing domain, email, or apiToken")

    from app.scripts.ask_jira import _discover_sync

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None, lambda: _discover_sync(domain, email, api_token)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["projects"] = result.get("projects", [])
    meta["boards"] = result.get("boards", [])
    meta["projectCount"] = len(meta["projects"])
    meta["boardCount"] = len(meta["boards"])
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
