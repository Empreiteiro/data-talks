"""Tests for health check and public config endpoints."""
import pytest


@pytest.mark.asyncio
async def test_health_returns_ok(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_config_login_disabled(client):
    """With ENABLE_LOGIN=false the config endpoint should say login is not required."""
    response = await client.get("/api/config")
    assert response.status_code == 200
    data = response.json()
    assert "loginRequired" in data
    assert data["loginRequired"] is False


@pytest.mark.asyncio
async def test_root_without_frontend(client):
    """Without a built frontend the root endpoint returns API info."""
    response = await client.get("/")
    assert response.status_code == 200
    body = response.json()
    # Should be either the API info dict or the SPA index (if dist/ exists in test)
    assert isinstance(body, dict)


@pytest.mark.asyncio
async def test_docs_available(client):
    """OpenAPI docs should be accessible."""
    response = await client.get("/docs")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_favicon_no_404(client):
    """Favicon should return 204 (no content) instead of 404."""
    response = await client.get("/favicon.ico")
    assert response.status_code == 204
