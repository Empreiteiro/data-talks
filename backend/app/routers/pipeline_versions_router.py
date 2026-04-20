"""Pipeline version history, diff, restore, and push-to-GitHub.

All routes are scoped to `(agent_id, pipeline_id)` and enforce ownership
through `require_user` + agent.user_id.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.database import get_db
from app.models import Agent, GithubConnection, PipelineVersion, User
from app.services.crypto import decrypt_text
from app.services.github_oauth import (
    GitHubOAuthNotConfigured,
    list_writable_repos,
    put_file,
)
from app.services.pipeline_versioning import (
    diff_versions,
    get_version,
    list_versions,
    restore_version,
    snapshot_pipeline,
    version_to_dict,
)


router = APIRouter(
    prefix="/agents/{agent_id}/pipelines/{pipeline_id}/versions",
    tags=["pipeline-versions"],
)


async def _require_agent(
    db: AsyncSession, user: User, agent_id: str, pipeline_id: str
) -> Agent:
    r = await db.execute(
        select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id)
    )
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    pipelines = (agent.workspace_config or {}).get("pipelines") or []
    if not any(isinstance(p, dict) and p.get("id") == pipeline_id for p in pipelines):
        raise HTTPException(404, f"Pipeline {pipeline_id} not found on agent")
    return agent


class CommitRequest(BaseModel):
    message: str | None = None


@router.get("")
async def list_pipeline_versions(
    agent_id: str,
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> list[dict]:
    await _require_agent(db, user, agent_id, pipeline_id)
    versions = await list_versions(db, agent_id=agent_id, pipeline_id=pipeline_id)
    return [version_to_dict(v) for v in versions]


@router.post("")
async def commit_pipeline_version(
    agent_id: str,
    pipeline_id: str,
    body: CommitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    agent = await _require_agent(db, user, agent_id, pipeline_id)
    version = await snapshot_pipeline(
        db,
        user=user,
        agent=agent,
        pipeline_id=pipeline_id,
        message=(body.message or "").strip() or None,
    )
    await db.commit()
    return version_to_dict(version)


@router.get("/{version_id}")
async def get_pipeline_version(
    agent_id: str,
    pipeline_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    await _require_agent(db, user, agent_id, pipeline_id)
    version = await get_version(db, version_id=version_id, user=user)
    if not version or version.agent_id != agent_id or version.pipeline_id != pipeline_id:
        raise HTTPException(404, "Version not found")
    return {**version_to_dict(version), "snapshot": version.snapshot}


@router.post("/{version_id}/restore")
async def restore_pipeline_version(
    agent_id: str,
    pipeline_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    agent = await _require_agent(db, user, agent_id, pipeline_id)
    version = await get_version(db, version_id=version_id, user=user)
    if not version or version.agent_id != agent_id or version.pipeline_id != pipeline_id:
        raise HTTPException(404, "Version not found")
    new_version = await restore_version(db, user=user, agent=agent, version=version)
    await db.commit()
    return version_to_dict(new_version)


@router.get("/diff")
async def diff_pipeline_versions(
    agent_id: str,
    pipeline_id: str,
    a: str = Query(..., description="Version id A (base)"),
    b: str = Query(..., description="Version id B (compare)"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    await _require_agent(db, user, agent_id, pipeline_id)
    va = await get_version(db, version_id=a, user=user)
    vb = await get_version(db, version_id=b, user=user)
    if not va or not vb or va.agent_id != agent_id or vb.agent_id != agent_id:
        raise HTTPException(404, "Version not found")
    if va.pipeline_id != pipeline_id or vb.pipeline_id != pipeline_id:
        raise HTTPException(400, "Versions must belong to the same pipeline")
    return diff_versions(va.snapshot or {}, vb.snapshot or {})


@router.post("/{version_id}/push-to-github")
async def push_version_to_github(
    agent_id: str,
    pipeline_id: str,
    version_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    agent = await _require_agent(db, user, agent_id, pipeline_id)
    version = await get_version(db, version_id=version_id, user=user)
    if not version or version.agent_id != agent_id or version.pipeline_id != pipeline_id:
        raise HTTPException(404, "Version not found")

    r = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == user.id)
    )
    conn = r.scalar_one_or_none()
    if not conn:
        raise HTTPException(400, "GitHub not connected")
    if not conn.selected_repo_full_name:
        raise HTTPException(400, "No GitHub repository selected")

    try:
        access_token = decrypt_text(conn.access_token_enc)
    except RuntimeError as e:
        raise HTTPException(500, f"Failed to read GitHub token: {e}")

    # Re-validate that the token still has push access to the selected repo.
    try:
        repos = await list_writable_repos(access_token, limit=200)
    except GitHubOAuthNotConfigured as e:
        raise HTTPException(500, str(e))
    allowed = {r["full_name"] for r in repos}
    if conn.selected_repo_full_name not in allowed:
        raise HTTPException(
            403,
            f"You no longer have push access to {conn.selected_repo_full_name}.",
        )

    base_path = (conn.selected_base_path or "data-talks/pipelines").strip("/")
    path = f"{base_path}/{agent_id}/{pipeline_id}/v{version.version_number}.json"
    content = json.dumps(
        {
            "version_number": version.version_number,
            "agent_id": agent_id,
            "pipeline_id": pipeline_id,
            "message": version.message,
            "created_at": version.created_at.isoformat() if version.created_at else None,
            "snapshot": version.snapshot,
        },
        indent=2,
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")

    agent_name = agent.name or agent_id
    pipeline_name = (version.snapshot or {}).get("name") or pipeline_id
    commit_message = (
        f"data-talks: pipeline {agent_name}/{pipeline_name} v{version.version_number}"
    )
    if version.message:
        commit_message += f" — {version.message}"

    try:
        result = await put_file(
            access_token,
            repo_full_name=conn.selected_repo_full_name,
            branch=conn.selected_branch or "main",
            path=path,
            content=content,
            message=commit_message,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Failed to push to GitHub: {e}")

    commit = (result or {}).get("commit") or {}
    sha = commit.get("sha")
    url = commit.get("html_url")
    version.github_commit_sha = sha
    version.github_commit_url = url
    await db.commit()
    return {
        **version_to_dict(version),
        "github_commit_sha": sha,
        "github_commit_url": url,
        "path": path,
    }
