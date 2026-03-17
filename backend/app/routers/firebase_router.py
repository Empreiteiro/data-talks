"""
Firebase/Firestore discovery and source metadata refresh.
- List collections from credentials
- Refresh source metadata (collection_infos with fields and preview docs)
"""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db, AsyncSessionLocal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/firebase", tags=["firebase"])


@router.post("/collections")
async def list_collections(
    body: dict,
    user: User = Depends(require_user),
):
    """List top-level Firestore collections. Body: { "credentialsContent": "..." } or { "sourceId": "..." }."""
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    source_id = body.get("sourceId")

    if source_id and not credentials_content:
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
            source = r.scalar_one_or_none()
            if not source or source.type != "firebase":
                raise HTTPException(404, "Firebase source not found")
            meta = source.metadata_ or {}
            credentials_content = meta.get("credentialsContent") or meta.get("credentials_content")

    if not credentials_content:
        raise HTTPException(400, "credentialsContent or sourceId required")

    from app.scripts.ask_firebase import _list_collections_sync

    loop = asyncio.get_event_loop()
    try:
        collection_names = await loop.run_in_executor(
            None, lambda: _list_collections_sync(credentials_content)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"collections": [{"id": c, "name": c} for c in collection_names]}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch Firestore collection schema (field names + preview docs) and update source metadata."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "firebase":
        raise HTTPException(400, "Source is not Firebase")

    meta = dict(source.metadata_ or {})
    creds = meta.get("credentialsContent") or meta.get("credentials_content")
    if not creds:
        raise HTTPException(400, "Source has no credentials")

    collections = meta.get("collections") or []
    if not collections:
        raise HTTPException(400, "Source has no collections configured")

    from app.scripts.ask_firebase import _fetch_collection_infos_sync

    loop = asyncio.get_event_loop()
    try:
        collection_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_collection_infos_sync(creds, collections, sample_size=50),
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["collection_infos"] = collection_infos
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
