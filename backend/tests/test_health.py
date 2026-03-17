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
    """Root returns 200: either API info (JSON) when no frontend build, or SPA HTML when dist/ exists."""
    response = await client.get("/")
    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        body = response.json()
        assert isinstance(body, dict)
    else:
        # SPA served (StaticFiles): response is HTML
        text = response.text
        assert isinstance(text, str) and len(text) > 0


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
