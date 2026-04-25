"""Source onboarding (Task 3).

Three endpoints:
  - `POST /sources/{id}/onboarding/profile` — builds a structured
    profile of the source (tables / columns / sample rows / per-column
    stats — whatever is already cached in `Source.metadata_`) and asks
    the LLM for clarifying questions, warm-up questions, and KPI
    candidates. Synchronous: the user sits on a spinner until it
    returns. Spec decision was "synchronous so the user is forced to
    answer or skip" — async + polling rejected.
  - `POST /sources/{id}/onboarding/save` — persists the user's
    confirmed clarifications, warm-up questions (merged into
    `Agent.suggested_questions`), and KPIs (`OrganizationKpi`). Marks
    `Source.metadata_["onboarding_completed_at"]` so the UI knows not
    to prompt again.
  - `GET /sources/{id}/onboarding` — returns the saved learnings so
    the user can review/edit later.

Tenancy: every query is filtered by `tenant_filter(...)` against the
caller's TenantScope. KPIs and clarifications are explicitly written
with `organization_id = scope.organization_id`. Mutations require the
`member` role; reads are open to any membership tier.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_role
from app.database import get_db
from app.llm.onboarding import generate_onboarding_suggestions
from app.models import (
    Agent,
    OrganizationKpi,
    Source,
    SourceClarification,
)
from app.routers.ask import _llm_config_to_overrides
from app.schemas import (
    OnboardingProfileResponse,
    OnboardingSavedResponse,
    OnboardingSaveRequest,
)
from app.services.tenant_scope import tenant_filter
from app.models import LlmConfig


router = APIRouter(tags=["onboarding"])


# --------------------------------------------------------------------- helpers


def _build_source_profile(source: Source) -> dict[str, Any]:
    """Build the profile dict the LLM sees.

    We don't re-introspect the source here — for CSV/uploaded files
    `crud.py` already cached `sample_profile`, `table_infos`, `columns`,
    and `preview_rows` into `Source.metadata_` at upload time. For
    SQL/BigQuery we use whatever schema metadata is in there. This
    means the profile quality depends on what was captured during
    source creation, which is good enough for v1 — re-introspecting
    a 500-table warehouse synchronously inside the onboarding modal
    would be the wrong tradeoff.
    """
    meta = source.metadata_ or {}
    profile: dict[str, Any] = {
        "source_type": source.type,
        "source_name": source.name,
    }
    # Pull the well-known keys we know exist for various source types.
    # Anything missing is silently dropped — the LLM handles partial
    # input fine.
    for key in (
        "tables",
        "table_infos",
        "columns",
        "preview_rows",
        "sample_profile",
        "row_count",
        "schema",
        "datasetId",
        "projectId",
    ):
        if key in meta and meta[key] is not None:
            profile[key] = meta[key]
    return profile


async def _resolve_llm_overrides(
    db: AsyncSession, scope: TenantScope, source: Source
) -> Optional[dict]:
    """Pick an LLM config for the onboarding call.

    Order of preference:
      1. The agent that owns this source, if it has `llm_config_id` set.
      2. The user's default `LlmConfig` (the one with `is_default=True`).
      3. None — `chat_completion` falls back to env-level settings.
    """
    if source.agent_id:
        r = await db.execute(
            select(Agent).where(
                Agent.id == source.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = r.scalar_one_or_none()
        if agent and agent.llm_config_id:
            r_cfg = await db.execute(
                select(LlmConfig).where(
                    LlmConfig.id == agent.llm_config_id,
                    LlmConfig.user_id == scope.user.id,
                )
            )
            cfg = r_cfg.scalar_one_or_none()
            if cfg:
                return _llm_config_to_overrides(cfg)
    r_default = await db.execute(
        select(LlmConfig).where(
            LlmConfig.user_id == scope.user.id, LlmConfig.is_default == True  # noqa: E712
        )
    )
    default_cfg = r_default.scalar_one_or_none()
    if default_cfg:
        return _llm_config_to_overrides(default_cfg)
    return None


async def _load_saved(
    db: AsyncSession, scope: TenantScope, source: Source
) -> OnboardingSavedResponse:
    """Read everything currently persisted for this source/workspace."""
    # Clarifications: scoped by source + tenant.
    r = await db.execute(
        select(SourceClarification).where(
            SourceClarification.source_id == source.id,
            SourceClarification.organization_id == scope.organization_id,
        )
    )
    clarifications = [
        {"id": c.id, "question": c.question, "answer": c.answer}
        for c in r.scalars().all()
    ]
    # KPIs: tenant-scoped, but only those that pertain to this source
    # (`source_ids` JSON list contains source.id) OR have no source
    # pinned (cross-source KPIs are also relevant context).
    r = await db.execute(
        select(OrganizationKpi).where(
            OrganizationKpi.organization_id == scope.organization_id
        )
    )
    kpi_rows = []
    for k in r.scalars().all():
        sids = k.source_ids or []
        if not sids or source.id in sids:
            kpi_rows.append(
                {
                    "id": k.id,
                    "name": k.name,
                    "definition": k.definition,
                    "dependencies": k.dependencies or {},
                    "source_ids": sids,
                }
            )
    # Warm-up questions live on the agent — pull from there. We also
    # surface `agent.description` here so the onboarding UI can
    # pre-fill the "Specific Instructions for the Agent" textarea.
    warmups: list[dict] = []
    agent_instructions = ""
    if source.agent_id:
        r = await db.execute(
            select(Agent).where(
                Agent.id == source.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = r.scalar_one_or_none()
        if agent:
            if agent.suggested_questions:
                warmups = [{"text": q} for q in agent.suggested_questions if q]
            agent_instructions = agent.description or ""
    completed_raw = (source.metadata_ or {}).get("onboarding_completed_at")
    return OnboardingSavedResponse(
        clarifications=clarifications,
        warmup_questions=warmups,
        kpis=kpi_rows,
        onboarding_completed_at=completed_raw,
        agent_instructions=agent_instructions,
    )


# --------------------------------------------------------------------- routes


class OnboardingProfileRequest(BaseModel):
    language: Optional[str] = None  # "en" | "pt" | "es"


@router.post(
    "/sources/{source_id}/onboarding/profile",
    response_model=OnboardingProfileResponse,
)
async def onboarding_profile(
    source_id: str,
    body: OnboardingProfileRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Build the source profile and ask the LLM for initial suggestions."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    profile = _build_source_profile(source)
    overrides = await _resolve_llm_overrides(db, scope, source)

    try:
        suggestions = await generate_onboarding_suggestions(
            profile=profile,
            language=body.language,
            llm_overrides=overrides,
        )
    except Exception as e:  # noqa: BLE001 - surface the underlying error to the caller
        raise HTTPException(
            502,
            f"LLM failed to produce onboarding suggestions: {type(e).__name__}: {str(e)[:300]}",
        )

    return OnboardingProfileResponse(
        profile=profile,
        clarifications=suggestions["clarifications"],
        warmup_questions=suggestions["warmup_questions"],
        kpis=suggestions["kpis"],
    )


@router.post(
    "/sources/{source_id}/onboarding/save",
    response_model=OnboardingSavedResponse,
)
async def onboarding_save(
    source_id: str,
    body: OnboardingSaveRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_role("member")),
):
    """Persist the user's confirmed onboarding output.

    Strategy: we replace clarifications wholesale (the UI sends the
    final list), append warm-up questions to the agent's existing list
    (deduped), and upsert KPIs by id. This keeps the API simple — the
    client doesn't need to track per-row state machines.
    """
    r = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # ---- Clarifications: replace-all ----
    await db.execute(
        delete(SourceClarification).where(
            SourceClarification.source_id == source.id,
            SourceClarification.organization_id == scope.organization_id,
        )
    )
    for c in body.clarifications:
        if not (c.question.strip() and c.answer.strip()):
            continue
        db.add(
            SourceClarification(
                id=str(uuid.uuid4()),
                organization_id=scope.organization_id,
                source_id=source.id,
                question=c.question.strip(),
                answer=c.answer.strip(),
            )
        )

    # ---- Warm-up questions + agent instructions: write to Agent ----
    # We only run this branch if there's an actual agent attached to
    # the source AND we have something agent-scoped to update. The
    # `agent_instructions` field is `None` when omitted (caller didn't
    # touch the textarea) and `""` when the user explicitly cleared
    # it; both empty and non-empty strings are honored — only `None`
    # leaves the existing description untouched.
    if source.agent_id and (body.warmup_questions or body.agent_instructions is not None):
        r = await db.execute(
            select(Agent).where(
                Agent.id == source.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = r.scalar_one_or_none()
        if agent:
            if body.warmup_questions:
                existing = list(agent.suggested_questions or [])
                seen = {q.strip().lower() for q in existing if isinstance(q, str)}
                for w in body.warmup_questions:
                    t = (w.text or "").strip()
                    if t and t.lower() not in seen:
                        existing.append(t)
                        seen.add(t.lower())
                agent.suggested_questions = existing
            if body.agent_instructions is not None:
                agent.description = body.agent_instructions.strip()

    # ---- KPIs: upsert by id, scoped to this organization ----
    incoming_ids: set[str] = set()
    for k in body.kpis:
        if not (k.name.strip() and k.definition.strip()):
            continue
        # Always include the current source in `source_ids` if absent —
        # the user opened the flow from this source, so it's at least
        # one of the things the KPI depends on.
        sids = list(k.source_ids or [])
        if source.id not in sids:
            sids.append(source.id)

        if k.id:
            r = await db.execute(
                select(OrganizationKpi).where(
                    OrganizationKpi.id == k.id,
                    OrganizationKpi.organization_id == scope.organization_id,
                )
            )
            existing = r.scalar_one_or_none()
            if existing:
                existing.name = k.name.strip()
                existing.definition = k.definition.strip()
                existing.dependencies = k.dependencies or {}
                existing.source_ids = sids
                existing.updated_at = datetime.utcnow()
                incoming_ids.add(existing.id)
                continue
        new_id = str(uuid.uuid4())
        db.add(
            OrganizationKpi(
                id=new_id,
                organization_id=scope.organization_id,
                name=k.name.strip(),
                definition=k.definition.strip(),
                source_ids=sids,
                dependencies=k.dependencies or {},
                created_by_user_id=scope.user.id,
            )
        )
        incoming_ids.add(new_id)

    # ---- Mark the source as onboarded ----
    meta = dict(source.metadata_ or {})
    meta["onboarding_completed_at"] = datetime.utcnow().isoformat()
    source.metadata_ = meta

    await db.commit()
    await db.refresh(source)
    return await _load_saved(db, scope, source)


@router.get(
    "/sources/{source_id}/onboarding",
    response_model=OnboardingSavedResponse,
)
async def onboarding_get(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Return saved onboarding learnings for a source.

    Used by the UI to render the "edit existing" view of the flow on
    sources where the user has already gone through onboarding once.
    """
    r = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    return await _load_saved(db, scope, source)
