"""Tests for pipeline versioning service: snapshot, diff, restore, sanitization."""
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.services.pipeline_versioning import (
    diff_versions,
    list_versions,
    restore_version,
    sanitize_snapshot,
    snapshot_pipeline,
)


def _sample_pipeline(pid: str = "pipeline_1") -> dict:
    return {
        "id": pid,
        "name": "My pipeline",
        "description": "A test",
        "schedule": "daily",
        "steps": [
            {"id": "s1", "name": "Extract", "type": "extract", "source": "src_a"},
            {"id": "s2", "name": "Transform", "type": "transform", "sql": "SELECT 1"},
        ],
    }


def test_sanitize_snapshot_removes_secret_like_keys():
    raw = {
        "id": "x",
        "api_key": "sk-should-be-gone",
        "nested": {"password": "hunter2", "value": 1},
        "items": [{"token": "abc", "ok": True}],
    }
    clean = sanitize_snapshot(raw)
    assert clean["api_key"] is None
    assert clean["nested"]["password"] is None
    assert clean["nested"]["value"] == 1
    assert clean["items"][0]["token"] is None
    assert clean["items"][0]["ok"] is True


def test_diff_versions_detects_add_remove_change():
    a = _sample_pipeline()
    b = {
        "id": "pipeline_1",
        "name": "My pipeline (renamed)",
        "description": "A test",
        "schedule": "daily",
        "steps": [
            {"id": "s1", "name": "Extract", "type": "extract", "source": "src_b"},
            {"id": "s3", "name": "Load", "type": "load"},
        ],
    }
    d = diff_versions(a, b)
    # s1 changed (source)
    assert any(c["id"] == "s1" and "source" in c["fields"] for c in d["changed_steps"])
    # s2 removed
    assert any(s["id"] == "s2" for s in d["removed_steps"])
    # s3 added
    assert any(s["id"] == "s3" for s in d["added_steps"])
    # top-level: name changed
    assert "name" in d["top_level"]


def test_diff_identical_returns_empty():
    a = _sample_pipeline()
    b = _sample_pipeline()
    d = diff_versions(a, b)
    assert d["added_steps"] == []
    assert d["removed_steps"] == []
    assert d["changed_steps"] == []
    assert d["top_level"] == {}


@pytest_asyncio.fixture
async def db_session(app):
    """Yield a committed DB session from the test app."""
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        yield s


async def _seed_user_and_agent(db) -> tuple:
    import uuid as _uuid
    from app.models import Agent, User

    user = User(
        id=str(_uuid.uuid4()),
        email=f"t-{_uuid.uuid4().hex[:8]}@example.com",
        hashed_password="x",
        organization_id=str(_uuid.uuid4()),
        role="user",
    )
    db.add(user)

    agent = Agent(
        id=str(_uuid.uuid4()),
        user_id=user.id,
        organization_id=user.organization_id,
        name="ETL test",
        description="",
        workspace_type="etl",
        workspace_config={"pipelines": [_sample_pipeline()]},
        source_ids=[],
        source_relationships=[],
        suggested_questions=[],
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return user, agent


@pytest.mark.asyncio
async def test_snapshot_and_list_versions(db_session):
    user, agent = await _seed_user_and_agent(db_session)

    v1 = await snapshot_pipeline(
        db_session, user=user, agent=agent, pipeline_id="pipeline_1", message="v1"
    )
    await db_session.commit()
    assert v1.version_number == 1
    assert v1.message == "v1"
    assert v1.parent_version_id is None

    v2 = await snapshot_pipeline(
        db_session, user=user, agent=agent, pipeline_id="pipeline_1", message="v2"
    )
    await db_session.commit()
    assert v2.version_number == 2
    assert v2.parent_version_id == v1.id

    versions = await list_versions(db_session, agent_id=agent.id, pipeline_id="pipeline_1")
    assert len(versions) == 2
    # newest first
    assert versions[0].version_number == 2


@pytest.mark.asyncio
async def test_restore_version_creates_new_version(db_session):
    user, agent = await _seed_user_and_agent(db_session)
    v1 = await snapshot_pipeline(
        db_session, user=user, agent=agent, pipeline_id="pipeline_1", message="v1"
    )
    await db_session.commit()

    # Mutate pipeline in-place on the agent and save again
    wc = dict(agent.workspace_config or {})
    pipelines = list(wc.get("pipelines") or [])
    pipelines[0] = {**pipelines[0], "name": "Renamed"}
    wc["pipelines"] = pipelines
    agent.workspace_config = wc
    await db_session.commit()

    v2 = await snapshot_pipeline(
        db_session, user=user, agent=agent, pipeline_id="pipeline_1", message="v2"
    )
    await db_session.commit()
    assert v2.snapshot["name"] == "Renamed"

    # Now restore v1
    v3 = await restore_version(db_session, user=user, agent=agent, version=v1)
    await db_session.commit()
    await db_session.refresh(agent)
    assert v3.version_number == 3
    assert v3.restored_from_version_id == v1.id
    # Pipeline in workspace should match v1 snapshot (name "My pipeline")
    assert (agent.workspace_config["pipelines"][0]["name"]) == "My pipeline"
