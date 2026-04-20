"""Pipeline version snapshots with diff and rollback.

A pipeline lives inside `Agent.workspace_config["pipelines"]` as a JSON dict
identified by `pipeline.id`. A `PipelineVersion` row is an immutable snapshot
of that dict plus metadata (author, message, parent). Restoring a version
writes the snapshot back into the agent and creates a new version pointing at
the restored one, so history is never rewritten.
"""
from __future__ import annotations

import copy
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, PipelineVersion, User


_SECRET_KEY_RE = re.compile(r"(?i)(key|secret|token|password|credential|private)")


def sanitize_snapshot(obj: Any) -> Any:
    """Recursively scrub keys that look like secrets. Values under matching keys
    are replaced with None so the snapshot is safe to store and push to GitHub.
    """
    if isinstance(obj, dict):
        out: dict = {}
        for k, v in obj.items():
            if isinstance(k, str) and _SECRET_KEY_RE.search(k):
                out[k] = None
            else:
                out[k] = sanitize_snapshot(v)
        return out
    if isinstance(obj, list):
        return [sanitize_snapshot(v) for v in obj]
    return obj


def _find_pipeline(agent: Agent, pipeline_id: str) -> dict | None:
    pipelines = ((agent.workspace_config or {}).get("pipelines")) or []
    for p in pipelines:
        if isinstance(p, dict) and p.get("id") == pipeline_id:
            return p
    return None


async def _next_version_number(db: AsyncSession, agent_id: str, pipeline_id: str) -> int:
    r = await db.execute(
        select(PipelineVersion.version_number)
        .where(
            PipelineVersion.agent_id == agent_id,
            PipelineVersion.pipeline_id == pipeline_id,
        )
        .order_by(PipelineVersion.version_number.desc())
        .limit(1)
    )
    last = r.scalar_one_or_none()
    return (last or 0) + 1


async def snapshot_pipeline(
    db: AsyncSession,
    *,
    user: User,
    agent: Agent,
    pipeline_id: str,
    message: str | None = None,
    parent_version_id: str | None = None,
    restored_from_version_id: str | None = None,
) -> PipelineVersion:
    """Create an immutable snapshot of the current pipeline dict."""
    pipeline = _find_pipeline(agent, pipeline_id)
    if pipeline is None:
        raise ValueError(f"Pipeline not found on agent: {pipeline_id}")

    snapshot = sanitize_snapshot(copy.deepcopy(pipeline))

    # Derive parent if not provided: the latest existing version.
    if parent_version_id is None:
        r = await db.execute(
            select(PipelineVersion.id)
            .where(
                PipelineVersion.agent_id == agent.id,
                PipelineVersion.pipeline_id == pipeline_id,
            )
            .order_by(PipelineVersion.version_number.desc())
            .limit(1)
        )
        parent_version_id = r.scalar_one_or_none()

    version_number = await _next_version_number(db, agent.id, pipeline_id)
    version = PipelineVersion(
        id=str(uuid.uuid4()),
        user_id=user.id,
        agent_id=agent.id,
        pipeline_id=pipeline_id,
        version_number=version_number,
        snapshot=snapshot,
        message=(message or None),
        author_user_id=user.id,
        parent_version_id=parent_version_id,
        restored_from_version_id=restored_from_version_id,
    )
    db.add(version)
    await db.flush()
    return version


async def list_versions(
    db: AsyncSession,
    *,
    agent_id: str,
    pipeline_id: str,
) -> list[PipelineVersion]:
    r = await db.execute(
        select(PipelineVersion)
        .where(
            PipelineVersion.agent_id == agent_id,
            PipelineVersion.pipeline_id == pipeline_id,
        )
        .order_by(PipelineVersion.version_number.desc())
    )
    return list(r.scalars().all())


async def get_version(
    db: AsyncSession,
    *,
    version_id: str,
    user: User,
) -> PipelineVersion | None:
    r = await db.execute(
        select(PipelineVersion).where(
            PipelineVersion.id == version_id,
            PipelineVersion.user_id == user.id,
        )
    )
    return r.scalar_one_or_none()


async def restore_version(
    db: AsyncSession,
    *,
    user: User,
    agent: Agent,
    version: PipelineVersion,
) -> PipelineVersion:
    """Overwrite the pipeline dict on the agent with the version's snapshot,
    then record a new version that references the restored one as its origin.
    """
    if version.agent_id != agent.id or version.pipeline_id not in {
        (p or {}).get("id") for p in (agent.workspace_config or {}).get("pipelines") or []
    }:
        raise ValueError("Version does not belong to this agent/pipeline")

    workspace_config = dict(agent.workspace_config or {})
    pipelines = list(workspace_config.get("pipelines") or [])
    replaced = False
    for i, p in enumerate(pipelines):
        if isinstance(p, dict) and p.get("id") == version.pipeline_id:
            pipelines[i] = copy.deepcopy(version.snapshot)
            replaced = True
            break
    if not replaced:
        raise ValueError(f"Pipeline {version.pipeline_id} no longer on agent")

    workspace_config["pipelines"] = pipelines
    agent.workspace_config = workspace_config
    await db.flush()

    return await snapshot_pipeline(
        db,
        user=user,
        agent=agent,
        pipeline_id=version.pipeline_id,
        message=f"Restored v{version.version_number}",
        parent_version_id=version.id,
        restored_from_version_id=version.id,
    )


def diff_versions(a: dict, b: dict) -> dict:
    """Return a structural diff between two pipeline snapshots.

    Steps are matched by `id`. Fields on changed steps are reported as a
    name→{a, b} dict. Top-level fields are also reported.
    """
    a_steps = {s.get("id"): s for s in (a.get("steps") or []) if isinstance(s, dict) and s.get("id")}
    b_steps = {s.get("id"): s for s in (b.get("steps") or []) if isinstance(s, dict) and s.get("id")}

    added_ids = sorted(set(b_steps) - set(a_steps))
    removed_ids = sorted(set(a_steps) - set(b_steps))
    common_ids = sorted(set(a_steps) & set(b_steps))

    changed: list[dict] = []
    for sid in common_ids:
        sa = a_steps[sid]
        sb = b_steps[sid]
        fields: dict[str, dict] = {}
        for key in set(sa) | set(sb):
            if sa.get(key) != sb.get(key):
                fields[key] = {"a": sa.get(key), "b": sb.get(key)}
        if fields:
            changed.append({"id": sid, "name": sb.get("name") or sa.get("name"), "fields": fields})

    top_level: dict[str, dict] = {}
    for key in set(a) | set(b):
        if key == "steps":
            continue
        if a.get(key) != b.get(key):
            top_level[key] = {"a": a.get(key), "b": b.get(key)}

    return {
        "added_steps": [
            {"id": sid, "name": b_steps[sid].get("name"), "type": b_steps[sid].get("type")}
            for sid in added_ids
        ],
        "removed_steps": [
            {"id": sid, "name": a_steps[sid].get("name"), "type": a_steps[sid].get("type")}
            for sid in removed_ids
        ],
        "changed_steps": changed,
        "top_level": top_level,
    }


def version_to_dict(v: PipelineVersion) -> dict:
    return {
        "id": v.id,
        "agent_id": v.agent_id,
        "pipeline_id": v.pipeline_id,
        "version_number": v.version_number,
        "message": v.message,
        "author_user_id": v.author_user_id,
        "parent_version_id": v.parent_version_id,
        "restored_from_version_id": v.restored_from_version_id,
        "github_commit_sha": v.github_commit_sha,
        "github_commit_url": v.github_commit_url,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
