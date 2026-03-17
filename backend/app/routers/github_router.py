"""
GitHub file source discovery and metadata refresh.
- Validate repository access and parse a data file (CSV/TSV/JSON)
- List data files in a repository path
- Refresh source metadata (columns, preview_rows)
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.database import get_db
from app.models import Source, User
from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/github", tags=["github"])

_SUPPORTED_EXTENSIONS = {".csv", ".tsv", ".json", ".jsonl", ".ndjson"}


@router.post("/validate")
async def validate_github_file(
    body: dict,
    user: User = Depends(require_user),
):
    """
    Validate access to a GitHub repo file and return columns + preview rows.

    Body: { "githubToken": "...", "githubRepo": "owner/repo",
            "githubBranch": "main", "filePath": "data/sales.csv" }
    """
    from app.scripts.ask_github_file import _download_github_file, _parse_file_content

    github_repo = (body.get("githubRepo") or "").strip()
    file_path = (body.get("filePath") or "").strip()
    if not github_repo:
        raise HTTPException(400, "githubRepo is required")
    if not file_path:
        raise HTTPException(400, "filePath is required")

    try:
        content = await _download_github_file(
            token=body.get("githubToken"),
            repo=github_repo,
            branch=(body.get("githubBranch") or "main").strip(),
            file_path=file_path,
        )
        df = _parse_file_content(content, file_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to read file: {e}")

    columns = list(df.columns)
    preview_rows = df.head(5).to_dict(orient="records")
    return {
        "columns": columns,
        "previewRows": preview_rows,
        "rowCount": len(df),
    }


@router.post("/list-files")
async def list_github_files(
    body: dict,
    user: User = Depends(require_user),
):
    """
    List data files (CSV/TSV/JSON) in a repository directory.

    Body: { "githubToken": "...", "githubRepo": "owner/repo",
            "githubBranch": "main", "dirPath": "data" }
    """
    github_repo = (body.get("githubRepo") or "").strip()
    dir_path = (body.get("dirPath") or "").strip().strip("/")
    if not github_repo:
        raise HTTPException(400, "githubRepo is required")

    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = body.get("githubToken")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    branch = (body.get("githubBranch") or "main").strip()
    url = f"https://api.github.com/repos/{github_repo}/contents/{dir_path}?ref={branch}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers)
    except Exception as e:
        raise HTTPException(400, f"GitHub request failed: {e}")

    if resp.status_code == 401:
        raise HTTPException(400, "GitHub authentication failed. Check the token.")
    if resp.status_code == 404:
        raise HTTPException(400, f"Path '{dir_path}' not found in {github_repo}@{branch}.")
    if resp.status_code != 200:
        raise HTTPException(400, f"GitHub API error {resp.status_code}: {resp.text[:200]}")

    items = resp.json()
    if not isinstance(items, list):
        raise HTTPException(400, "Path points to a file, not a directory.")

    files = [
        {"name": item["name"], "path": item["path"], "size": item.get("size", 0)}
        for item in items
        if item.get("type") == "file"
        and any(item["name"].lower().endswith(ext) for ext in _SUPPORTED_EXTENSIONS)
    ]
    return {"files": files}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Re-download the file and update columns + preview_rows for the source."""
    from app.scripts.ask_github_file import _download_github_file, _parse_file_content

    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "github_file":
        raise HTTPException(400, "Source is not a GitHub file source")

    meta = dict(source.metadata_ or {})
    github_repo = meta.get("githubRepo", "")
    file_path = meta.get("filePath", "")
    if not github_repo or not file_path:
        raise HTTPException(400, "Source missing githubRepo or filePath")

    try:
        content = await _download_github_file(
            token=meta.get("githubToken"),
            repo=github_repo,
            branch=meta.get("githubBranch", "main"),
            file_path=file_path,
        )
        df = _parse_file_content(content, file_path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to refresh file: {e}")

    meta["columns"] = list(df.columns)
    meta["preview_rows"] = df.head(10).to_dict(orient="records")
    meta["row_count"] = len(df)
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
