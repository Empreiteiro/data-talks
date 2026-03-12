"""Pytest configuration and shared fixtures."""
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Use in-memory SQLite for tests (isolated from dev DB)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

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

    # Override the engine to use in-memory SQLite
    test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    test_session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Patch the database module
    db_module.engine = test_engine
    db_module.AsyncSessionLocal = test_session_factory

    # Create tables
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Import and configure app after patching
    from app.main import app as fastapi_app

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
