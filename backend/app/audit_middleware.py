"""
FastAPI middleware that automatically records audit trail entries for mutating API calls.
Captures POST, PUT, PATCH, DELETE requests and maps them to audit categories.
"""
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.audit import record_audit

# Route patterns mapped to (category, action_prefix, resource_type)
_ROUTE_MAP = {
    "/api/sources": ("source", "source", "source"),
    "/api/agents": ("agent", "agent", "agent"),
    "/api/settings/llm": ("config", "llm_settings", "llm_settings"),
    "/api/settings/llm-configs": ("config", "llm_config", "llm_config"),
    "/api/ask-question": ("query", "query", "qa_session"),
    "/api/alerts": ("config", "alert", "alert"),
    "/api/dashboards": ("config", "dashboard", "dashboard"),
    "/api/dashboard_charts": ("config", "dashboard_chart", "dashboard_chart"),
    "/api/telegram": ("config", "telegram", "telegram"),
    "/api/whatsapp": ("config", "whatsapp", "whatsapp"),
    "/api/api-keys": ("config", "api_key", "api_key"),
    "/api/auth/login": ("auth", "auth.login", "user"),
    "/api/auth/register": ("auth", "auth.register", "user"),
    "/api/table_summaries": ("query", "summary", "table_summary"),
    "/api/audio_overviews": ("query", "audio_overview", "audio_overview"),
    "/api/users": ("user", "user", "user"),
}

_METHOD_VERBS = {
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


def _get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _match_route(path: str) -> tuple[str, str, str] | None:
    for prefix, mapping in _ROUTE_MAP.items():
        if path.startswith(prefix):
            return mapping
    return None


def _extract_resource_id(path: str, prefix: str) -> str | None:
    remainder = path[len(prefix):].strip("/")
    parts = remainder.split("/")
    if parts and parts[0] and len(parts[0]) >= 8:
        return parts[0]
    return None


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Only audit mutating methods
        method = request.method.upper()
        if method not in _METHOD_VERBS:
            return response

        # Only audit successful requests
        if response.status_code >= 400:
            return response

        path = request.url.path
        match = _match_route(path)
        if not match:
            return response

        category, action_prefix, resource_type = match

        # Build action name
        if action_prefix.startswith("auth."):
            action = action_prefix
        else:
            verb = _METHOD_VERBS[method]
            action = f"{action_prefix}.{verb}"

        # Extract resource ID from URL path
        matched_prefix = next(p for p in _ROUTE_MAP if path.startswith(p))
        resource_id = _extract_resource_id(path, matched_prefix)

        # Get user info from request state (set by auth dependency)
        user_id = None
        user_email = None
        if hasattr(request.state, "audit_user_id"):
            user_id = request.state.audit_user_id
        if hasattr(request.state, "audit_user_email"):
            user_email = request.state.audit_user_email

        detail = f"{method} {path}"
        ip = _get_client_ip(request)
        ua = request.headers.get("user-agent", "")[:512]

        # Fire-and-forget to not slow down the response
        asyncio.create_task(
            record_audit(
                action=action,
                category=category,
                user_id=user_id,
                user_email=user_email,
                resource_type=resource_type,
                resource_id=resource_id,
                detail=detail,
                ip_address=ip,
                user_agent=ua,
            )
        )

        return response
