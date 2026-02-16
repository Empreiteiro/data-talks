"""
BigQuery discovery and source metadata refresh.
- List projects (from credentials or Resource Manager)
- List datasets for a project
- List tables for a dataset
- Refresh source metadata (table_infos with columns and optional preview)
"""
import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User
from app.database import get_db, AsyncSessionLocal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Source
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/bigquery", tags=["bigquery"])


@router.post("/projects")
async def list_projects(
    body: dict,
    user: User = Depends(require_user),
):
    """List projects. Body: { "credentialsContent": "..." } or { "sourceId": "..." }."""
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    source_id = body.get("sourceId")
    if source_id:
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
            source = r.scalar_one_or_none()
            if not source or source.type != "bigquery":
                raise HTTPException(404, "BigQuery source not found")
            meta = source.metadata_ or {}
            credentials_content = meta.get("credentialsContent") or meta.get("credentials_content")
            if not credentials_content:
                raise HTTPException(400, "Source has no credentials")
    if not credentials_content:
        raise HTTPException(400, "credentialsContent or sourceId required")
    try:
        creds_dict = json.loads(credentials_content)
        project_id_from_creds = creds_dict.get("project_id", "")
    except Exception:
        raise HTTPException(400, "Invalid credentials JSON")
    # Return project from credentials (service account has one project). Optionally list via Resource Manager.
    result = [{"id": project_id_from_creds, "name": project_id_from_creds}] if project_id_from_creds else []
    return {"projects": result}


@router.post("/datasets")
async def list_datasets(
    body: dict,
    user: User = Depends(require_user),
):
    """List datasets in a project. Body: { credentialsContent or sourceId, projectId }."""
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    source_id = body.get("sourceId")
    project_id = (body.get("projectId") or "").strip()
    if not project_id:
        raise HTTPException(400, "projectId is required")
    if source_id and not credentials_content:
        from app.database import async_session_maker
        async with async_session_maker() as db:
            r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
            source = r.scalar_one_or_none()
            if not source or source.type != "bigquery":
                raise HTTPException(404, "BigQuery source not found")
            meta = source.metadata_ or {}
            credentials_content = meta.get("credentialsContent") or meta.get("credentials_content")
    if not credentials_content:
        raise HTTPException(400, "credentialsContent or sourceId required")
    from app.scripts.ask_bigquery import _get_bigquery_client
    loop = asyncio.get_event_loop()
    try:
        client = await loop.run_in_executor(None, lambda: _get_bigquery_client(credentials_content))
        datasets = await loop.run_in_executor(
            None,
            lambda: list(client.list_datasets(project=project_id)),
        )
        result = [{"id": d.dataset_id, "name": d.dataset_id} for d in datasets]
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"datasets": result}


@router.post("/tables")
async def list_tables(
    body: dict,
    user: User = Depends(require_user),
):
    """List tables in a dataset. Body: { credentialsContent or sourceId, projectId, datasetId }."""
    credentials_content = body.get("credentialsContent") or body.get("credentials_content")
    source_id = body.get("sourceId")
    project_id = (body.get("projectId") or "").strip()
    dataset_id = (body.get("datasetId") or "").strip()
    if not project_id or not dataset_id:
        raise HTTPException(400, "projectId and datasetId are required")
    if source_id and not credentials_content:
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
            source = r.scalar_one_or_none()
            if not source or source.type != "bigquery":
                raise HTTPException(404, "BigQuery source not found")
            meta = source.metadata_ or {}
            credentials_content = meta.get("credentialsContent") or meta.get("credentials_content")
    if not credentials_content:
        raise HTTPException(400, "credentialsContent or sourceId required")
    from app.scripts.ask_bigquery import _get_bigquery_client
    loop = asyncio.get_event_loop()
    try:
        client = await loop.run_in_executor(None, lambda: _get_bigquery_client(credentials_content))
        dataset_ref = f"{project_id}.{dataset_id}"
        dataset = await loop.run_in_executor(None, lambda: client.get_dataset(dataset_ref))
        tables = await loop.run_in_executor(None, lambda: list(client.list_tables(dataset)))
        result = [{"id": t.table_id, "name": t.table_id} for t in tables]
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"tables": result}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch BigQuery schema (table_infos) for the source and update metadata. Returns updated metaJSON."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "bigquery":
        raise HTTPException(400, "Source is not BigQuery")
    meta = dict(source.metadata_ or {})
    creds = meta.get("credentialsContent") or meta.get("credentials_content")
    if not creds:
        raise HTTPException(400, "Source has no credentials")
    project_id = meta.get("projectId", "")
    dataset_id = meta.get("datasetId", "")
    tables = meta.get("tables") or []
    if not project_id or not dataset_id:
        raise HTTPException(400, "Source missing projectId or datasetId")
    from app.scripts.ask_bigquery import _get_bigquery_client, _fetch_table_infos_sync
    loop = asyncio.get_event_loop()
    try:
        client = await loop.run_in_executor(None, lambda: _get_bigquery_client(creds))
        table_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_table_infos_sync(client, project_id, dataset_id, tables),
        )
    except Exception as e:
        raise HTTPException(400, str(e))
    # Optionally fetch a few preview rows per table for the first table
    preview_rows = []
    if table_infos and len(table_infos) > 0:
        first = table_infos[0]
        table_name = first.get("table", "")
        cols = first.get("columns", [])
        if table_name and cols:
            try:
                from app.scripts.ask_bigquery import _run_query_sync
                q = f"SELECT * FROM `{project_id}.{dataset_id}.{table_name}` LIMIT 5"
                preview_rows = await loop.run_in_executor(None, lambda: _run_query_sync(client, q))
            except Exception:
                preview_rows = []
    # Build table_infos with preview for first table
    result_infos = []
    for i, ti in enumerate(table_infos):
        entry = {"table": ti.get("table", ""), "columns": ti.get("columns", [])}
        if i == 0 and preview_rows is not None:
            entry["preview_rows"] = preview_rows
        result_infos.append(entry)
    meta["table_infos"] = result_infos
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}


@router.post("/sources/{source_id}/full-table")
async def fetch_full_table(
    source_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch full BigQuery table data (up to limit rows). For graphs and full preview. Body: { limit?: number } default 50000."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "bigquery":
        raise HTTPException(400, "Source is not BigQuery")
    meta = dict(source.metadata_ or {})
    creds = meta.get("credentialsContent") or meta.get("credentials_content")
    if not creds:
        raise HTTPException(400, "Source has no credentials")
    project_id = meta.get("projectId", "")
    dataset_id = meta.get("datasetId", "")
    tables = meta.get("tables") or []
    table_infos = meta.get("table_infos") or []
    if not project_id or not dataset_id or not tables:
        raise HTTPException(400, "Source missing projectId, datasetId, or tables")
    table_name = tables[0] if tables else (table_infos[0].get("table", "") if table_infos else "")
    if not table_name:
        raise HTTPException(400, "No table selected")
    cols = table_infos[0].get("columns", []) if table_infos else []
    if not cols:
        raise HTTPException(400, "Table schema not loaded. Refresh source metadata first.")
    from app.scripts.ask_bigquery import _get_bigquery_client, _run_query_sync
    limit = int(body.get("limit", 50000)) if body else 50000
    limit = min(max(limit, 1), 100000)  # clamp 1..100000
    loop = asyncio.get_event_loop()
    try:
        client = await loop.run_in_executor(None, lambda: _get_bigquery_client(creds))
        q = f"SELECT * FROM `{project_id}.{dataset_id}.{table_name}` LIMIT {limit}"
        rows = await loop.run_in_executor(None, lambda: _run_query_sync(client, q))
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"columns": cols, "rows": _sanitize_for_json(rows)}
