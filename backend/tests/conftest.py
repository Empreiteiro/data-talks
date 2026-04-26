"""Pytest configuration and shared fixtures."""
import os
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Per-process temp file SQLite. Originally used `:memory:`, but
# aiosqlite gives each connection its own private :memory: database
# regardless of pool config — the conftest's `create_all` would
# populate one connection while the HTTP request would acquire a
# different empty one, producing "no such table: users" on every
# request that hit the DB. A single temp file works correctly across
# every connection from the engine pool. The file is created next to
# the test process and removed at session teardown.
_DB_TMPDIR = tempfile.mkdtemp(prefix="datatalks-test-db-")
_DB_FILE_PATH = os.path.join(_DB_TMPDIR, "test.db")
TEST_DATABASE_URL = f"sqlite+aiosqlite:///{_DB_FILE_PATH}"

# Set env vars BEFORE importing app so config/database pick them up
os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("ENABLE_LOGIN", "false")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-ci")


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(scope="function")
async def app():
    """Create a fresh FastAPI app with an in-memory DB for each test."""
    from app.config import get_settings
    from app.database import Base
    import app.database as db_module
    # Import the models module BEFORE create_all so every Mapped
    # class gets registered with Base.metadata. Without this import,
    # `metadata.create_all` runs against an empty registry and the
    # test DB ends up with zero tables — the cause of the "no such
    # table: users" failures the test suite had since CI was set up.
    import app.models  # noqa: F401

    # File-backed SQLite so create_all and HTTP-request connections
    # see the same database (see TEST_DATABASE_URL note). We still
    # drop_all + reset the file at teardown so tests don't leak
    # state into each other.
    if os.path.exists(_DB_FILE_PATH):
        os.unlink(_DB_FILE_PATH)
    test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    test_session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Patch the database module + every other module that captured a
    # reference at its own import time (`from app.database import
    # AsyncSessionLocal` makes a *binding*, not a live alias). Without
    # patching app.main, the seeder uses test 1's disposed factory on
    # test 2 and produces "no such table" errors despite test 2's
    # tables being freshly created.
    db_module.engine = test_engine
    db_module.AsyncSessionLocal = test_session_factory
    import sys as _sys
    if "app.main" in _sys.modules:
        _sys.modules["app.main"].engine = test_engine
        _sys.modules["app.main"].AsyncSessionLocal = test_session_factory
    # No print debug here — the test suite is now stable, kept the
    # comment instead so future maintainers know about the
    # cross-module rebinding gotcha.

    # Create tables
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Import and configure app after patching
    from app.main import app as fastapi_app

    # Seed the single-user (guest or admin) row + their personal org +
    # owner membership. This is what the production lifespan does on
    # startup; without it, every test that hits an authenticated
    # endpoint gets "Guest user missing; run migrations". httpx's
    # ASGITransport doesn't run lifespan, so we call the seeder
    # explicitly. We intentionally do NOT call the rest of the
    # lifespan (column-upgrade ALTERs, storage init, background
    # workers) — `create_all` already creates the latest schema and
    # the workers leak asyncio tasks that complicate teardown.
    from app.main import _ensure_single_user
    await _ensure_single_user()

    yield fastapi_app

    # Drop tables and dispose engine after each test
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(app):
    """Async HTTP client backed by the test app."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
