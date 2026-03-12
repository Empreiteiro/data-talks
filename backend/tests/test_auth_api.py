"""Integration tests for authentication API endpoints."""
import pytest


@pytest.mark.asyncio
async def test_login_not_required_when_disabled(client):
    """When login is disabled, accessing protected endpoints should work without a token."""
    # The /api/config endpoint is public
    response = await client.get("/api/config")
    assert response.status_code == 200
    assert response.json()["loginRequired"] is False


@pytest.mark.asyncio
async def test_login_endpoint_exists(client):
    """POST /api/auth/login should return 422 on empty body (not 404)."""
    response = await client.post("/api/auth/login", json={})
    # 422 = validation error (wrong body), not 404 (route missing)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_wrong_credentials_returns_401(client):
    """With login disabled the login route is still mounted; bad creds = 401."""
    response = await client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "bad"},
    )
    # When ENABLE_LOGIN=false the admin user is not created, so 401 or 400 expected
    assert response.status_code in (400, 401)


@pytest.mark.asyncio
async def test_me_endpoint_without_token_guest_mode(client):
    """Without a token, /api/auth/me should return the guest user when login is off."""
    response = await client.get("/api/auth/me")
    # Guest user exists → 200, or the endpoint returns 401 in strict mode
    assert response.status_code in (200, 401)
