"""
dbt source discovery and metadata refresh.
- Validate manifest (GitHub or dbt Cloud) and list available models
- Refresh source metadata (table_infos from manifest)
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.database import get_db
from app.models import Source, User
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/dbt", tags=["dbt"])


@router.post("/validate-manifest")
async def validate_manifest(
    body: dict,
    user: User = Depends(require_user),
):
    """
    Validate dbt credentials and return list of models from manifest.json.

    Body for GitHub source:
      { "projectSource": "github", "githubToken": "...", "githubRepo": "owner/repo",
        "githubBranch": "main", "manifestPath": "target/manifest.json" }

    Body for dbt Cloud source:
      { "projectSource": "cloud", "dbtCloudToken": "...",
        "dbtCloudAccountId": "123", "dbtCloudJobId": "456" }
    """
    from app.scripts.ask_dbt import (
        _fetch_manifest_from_github,
        _fetch_manifest_from_dbt_cloud,
        _extract_table_infos_from_manifest,
    )

    project_source = (body.get("projectSource") or "").strip()
    if project_source not in ("github", "cloud"):
        raise HTTPException(400, "projectSource must be 'github' or 'cloud'")

    try:
        if project_source == "github":
            github_repo = (body.get("githubRepo") or "").strip()
            if not github_repo:
                raise HTTPException(400, "githubRepo is required")
            manifest = await _fetch_manifest_from_github(
                token=body.get("githubToken"),
                repo=github_repo,
                branch=(body.get("githubBranch") or "main").strip(),
                manifest_path=(body.get("manifestPath") or "target/manifest.json").strip(),
            )
        else:
            dbt_cloud_token = (body.get("dbtCloudToken") or "").strip()
            dbt_cloud_account_id = str(body.get("dbtCloudAccountId") or "").strip()
            dbt_cloud_job_id = str(body.get("dbtCloudJobId") or "").strip()
            if not dbt_cloud_token or not dbt_cloud_account_id or not dbt_cloud_job_id:
                raise HTTPException(400, "dbtCloudToken, dbtCloudAccountId and dbtCloudJobId are required")
            manifest = await _fetch_manifest_from_dbt_cloud(
                token=dbt_cloud_token,
                account_id=dbt_cloud_account_id,
                job_id=dbt_cloud_job_id,
            )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to fetch manifest: {e}")

    table_infos = _extract_table_infos_from_manifest(manifest)
    models = [
        {"name": t["table"], "columns": t.get("columns", []), "description": t.get("description", "")}
        for t in table_infos
    ]
    return {"models": models, "total": len(models)}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Re-fetch manifest and update table_infos for the source."""
    from app.scripts.ask_dbt import (
        _fetch_manifest_from_github,
        _fetch_manifest_from_dbt_cloud,
        _extract_table_infos_from_manifest,
    )

    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "dbt":
        raise HTTPException(400, "Source is not a dbt source")

    meta = dict(source.metadata_ or {})
    project_source = meta.get("projectSource", "")

    try:
        if project_source == "github":
            manifest = await _fetch_manifest_from_github(
                token=meta.get("githubToken"),
                repo=meta.get("githubRepo", ""),
                branch=meta.get("githubBranch", "main"),
                manifest_path=meta.get("manifestPath", "target/manifest.json"),
            )
        elif project_source == "cloud":
            manifest = await _fetch_manifest_from_dbt_cloud(
                token=meta.get("dbtCloudToken", ""),
                account_id=str(meta.get("dbtCloudAccountId", "")),
                job_id=str(meta.get("dbtCloudJobId", "")),
            )
        else:
            raise HTTPException(400, f"Unknown projectSource: '{project_source}'")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to fetch manifest: {e}")

    selected_models = meta.get("selectedModels") or []
    table_infos = _extract_table_infos_from_manifest(manifest, selected_models or None)
    meta["table_infos"] = table_infos
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_, "modelCount": len(table_infos)}
