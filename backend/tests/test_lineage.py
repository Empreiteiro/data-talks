"""Tests for app.services.lineage: tracked_run + edge recording."""
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import LineageEdge, PipelineRun
from app.services.lineage import record_edge, tracked_run


@pytest_asyncio.fixture
async def db_session(app):
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as s:
        yield s


@pytest.mark.asyncio
async def test_tracked_run_success_path(db_session):
    async with tracked_run(
        db_session,
        user_id="user-123",
        organization_id="org-1",
        kind="qa",
        agent_id="agent-abc",
        metadata={"q": "hello"},
    ) as run:
        assert run is not None
        assert run.status == "running"
        await record_edge(
            db_session,
            run,
            source_kind="source",
            source_ref="src-1",
            target_kind="agent",
            target_ref="agent-abc",
            edge_type="read",
        )
    await db_session.commit()

    r = await db_session.execute(select(PipelineRun).where(PipelineRun.id == run.id))
    stored = r.scalar_one()
    assert stored.status == "success"
    assert stored.finished_at is not None
    assert stored.duration_ms is not None and stored.duration_ms >= 0

    r2 = await db_session.execute(select(LineageEdge).where(LineageEdge.run_id == run.id))
    edges = list(r2.scalars().all())
    assert len(edges) == 1
    assert edges[0].source_ref == "src-1"
    assert edges[0].target_ref == "agent-abc"
    assert edges[0].edge_type == "read"


@pytest.mark.asyncio
async def test_tracked_run_error_path_records_status(db_session):
    with pytest.raises(ValueError):
        async with tracked_run(
            db_session,
            user_id="user-456",
            kind="medallion_bronze",
            agent_id="agent-def",
        ) as run:
            assert run is not None
            raise ValueError("boom")

    # Run should exist with status=error even though the body raised.
    # Because we don't commit in the error path explicitly, we need to commit
    # here to assert via a new query. The tracked_run's finish_run flushes.
    await db_session.commit()
    r = await db_session.execute(select(PipelineRun).where(PipelineRun.kind == "medallion_bronze"))
    stored = r.scalar_one()
    assert stored.status == "error"
    assert stored.error_message == "boom"
