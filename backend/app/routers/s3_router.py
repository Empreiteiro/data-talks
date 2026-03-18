"""
Amazon S3 / MinIO discovery and source metadata refresh.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/s3", tags=["s3"])


def _extract_creds(body: dict) -> tuple[str, str, str, str | None]:
    ak = body.get("accessKeyId", "")
    sk = body.get("secretAccessKey", "")
    region = body.get("region", "us-east-1")
    endpoint = body.get("endpoint") or None
    if not ak or not sk:
        raise HTTPException(400, "accessKeyId and secretAccessKey are required")
    return ak, sk, region, endpoint


@router.post("/test-connection")
async def test_connection(body: dict, user: User = Depends(require_user)):
    ak, sk, region, endpoint = _extract_creds(body)
    from app.scripts.ask_s3 import _test_connection_sync
    loop = asyncio.get_event_loop()
    try:
        ok = await loop.run_in_executor(None, lambda: _test_connection_sync(ak, sk, region, endpoint))
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")


@router.post("/buckets")
async def list_buckets(body: dict, user: User = Depends(require_user)):
    ak, sk, region, endpoint = _extract_creds(body)
    from app.scripts.ask_s3 import _list_buckets_sync
    loop = asyncio.get_event_loop()
    try:
        buckets = await loop.run_in_executor(None, lambda: _list_buckets_sync(ak, sk, region, endpoint))
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"buckets": [{"id": b, "name": b} for b in buckets]}


@router.post("/objects")
async def list_objects(body: dict, user: User = Depends(require_user)):
    ak, sk, region, endpoint = _extract_creds(body)
    bucket = body.get("bucket", "")
    prefix = body.get("prefix", "")
    if not bucket:
        raise HTTPException(400, "bucket is required")
    from app.scripts.ask_s3 import _list_objects_sync
    loop = asyncio.get_event_loop()
    try:
        objects = await loop.run_in_executor(
            None, lambda: _list_objects_sync(ak, sk, region, endpoint, bucket, prefix)
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"objects": objects}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user),
):
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "s3":
        raise HTTPException(400, "Source is not S3")
    meta = dict(source.metadata_ or {})
    ak = meta.get("accessKeyId", "")
    sk = meta.get("secretAccessKey", "")
    region = meta.get("region", "us-east-1")
    endpoint = meta.get("endpoint") or None
    bucket = meta.get("bucket", "")
    key = meta.get("key", "")
    if not ak or not sk or not bucket or not key:
        raise HTTPException(400, "Source missing S3 credentials or file info")
    from app.scripts.ask_s3 import _download_and_parse_sync, _build_sample_profile
    loop = asyncio.get_event_loop()
    try:
        df = await loop.run_in_executor(
            None, lambda: _download_and_parse_sync(ak, sk, region, endpoint, bucket, key, meta.get("fileType"))
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    meta["columns"] = list(df.columns)
    meta["preview"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
    meta["rowCount"] = len(df)
    meta["sample_profile"] = _sanitize_for_json(_build_sample_profile(df.head(1000)))
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
