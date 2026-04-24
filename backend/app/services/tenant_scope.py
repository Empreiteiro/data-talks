"""Tenant-scoped query helpers.

Every query against a model that has an `organization_id` column MUST filter
by the caller's `TenantScope.organization_id`. This module provides the
`tenant_filter(model, scope)` convenience so routers can write:

    q = select(Source).where(
        tenant_filter(Source, scope),
        Source.id == source_id,
    )

instead of repeating `Source.organization_id == scope.organization_id`.
"""
from __future__ import annotations

from typing import Any

from app.auth import TenantScope


def tenant_filter(model: Any, scope: TenantScope):
    """Return a SQLAlchemy predicate that restricts `model` rows to the
    caller's organization.

    Raises `AttributeError` with a loud message if `model` doesn't have an
    `organization_id` column — that's intentional: callers should not use
    this helper on user-personal models like `LlmConfig`, they filter by
    `user_id` directly instead.
    """
    col = getattr(model, "organization_id", None)
    if col is None:
        raise AttributeError(
            f"{model.__name__} has no organization_id column; do not use tenant_filter on it"
        )
    return col == scope.organization_id
