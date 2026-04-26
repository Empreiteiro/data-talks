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
from app.llm.onboarding import (
    build_multi_source_profile,
    generate_onboarding_suggestions,
)
from app.models import (
    Agent,
    OrganizationKpi,
    Source,
    SourceClarification,
    SourceFilter,
    SourceGroup,
    SourceWarmup,
)
from app.routers.ask import _llm_config_to_overrides
from app.schemas import (
    OnboardingProfileResponse,
    OnboardingSavedResponse,
    OnboardingSaveRequest,
    SourceGroupCreate,
    SourceGroupResponse,
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


async def _resolve_llm_overrides_for_agent(
    db: AsyncSession, scope: TenantScope, agent_id: Optional[str]
) -> Optional[dict]:
    """Same resolution logic as _resolve_llm_overrides but takes an
    agent id directly — used by the group endpoints, which don't
    bind to a single source."""
    if agent_id:
        r = await db.execute(
            select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope))
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
            LlmConfig.user_id == scope.user.id,
            LlmConfig.is_default == True,  # noqa: E712
        )
    )
    default_cfg = r_default.scalar_one_or_none()
    if default_cfg:
        return _llm_config_to_overrides(default_cfg)
    return None


def _canonical_source_ids(ids: list[str]) -> list[str]:
    """Sort + dedupe the source_ids list. We sort so that {a,b,c} and
    {c,a,b} canonicalize to the same JSON list — that lets `find or
    create group` lookup by exact equality on the JSON column."""
    return sorted({sid for sid in ids if isinstance(sid, str) and sid})


async def _get_or_create_group(
    db: AsyncSession,
    scope: TenantScope,
    agent_id: Optional[str],
    source_ids: list[str],
) -> SourceGroup:
    """Idempotent upsert: find an existing group with the same
    (agent_id, canonical source_ids) within the org, or create one."""
    canonical = _canonical_source_ids(source_ids)
    if not canonical:
        raise HTTPException(400, "source_ids cannot be empty")
    # Validate every id resolves to a source we can see in this tenant.
    sr = await db.execute(
        select(Source).where(
            Source.id.in_(canonical),
            tenant_filter(Source, scope),
        )
    )
    visible = {s.id for s in sr.scalars().all()}
    if visible != set(canonical):
        raise HTTPException(404, "One or more sources not found in this organization")
    # Look for an existing group with matching agent + ids. We can't
    # filter on the JSON column equality across all dialects, so we
    # pull candidates by agent and compare in Python — the candidate
    # set is small (groups per workspace) so this is fine.
    rows = await db.execute(
        select(SourceGroup).where(
            SourceGroup.organization_id == scope.organization_id,
            (SourceGroup.agent_id == agent_id) if agent_id else (SourceGroup.agent_id.is_(None)),
        )
    )
    for g in rows.scalars().all():
        if _canonical_source_ids(g.source_ids or []) == canonical:
            return g
    g = SourceGroup(
        id=str(uuid.uuid4()),
        organization_id=scope.organization_id,
        agent_id=agent_id,
        source_ids=canonical,
    )
    db.add(g)
    await db.flush()
    return g


async def _load_saved_for_group(
    db: AsyncSession, scope: TenantScope, group: SourceGroup
) -> OnboardingSavedResponse:
    """Like `_load_saved` but for a SourceGroup. Filters assets by the
    group's canonical source_ids set rather than a single source id.
    """
    canonical = _canonical_source_ids(group.source_ids or [])
    canonical_set = set(canonical)

    # Clarifications: include any whose source_id is in the group.
    # (Clarifications still hang off individual sources; the group's
    # set is the union of their member-clarifications.)
    cr = await db.execute(
        select(SourceClarification).where(
            SourceClarification.source_id.in_(canonical),
            SourceClarification.organization_id == scope.organization_id,
        )
    )
    clarifications = [
        {"id": c.id, "question": c.question, "answer": c.answer}
        for c in cr.scalars().all()
    ]

    def _matches(sids: list[str] | None) -> bool:
        sids = sids or []
        return _canonical_source_ids(sids) == canonical

    # KPIs / warm-ups / filters: include rows whose source_ids match
    # this group exactly. Cross-source KPIs (empty source_ids) also
    # show up since they apply everywhere.
    kr = await db.execute(
        select(OrganizationKpi).where(
            OrganizationKpi.organization_id == scope.organization_id
        )
    )
    kpis = []
    for k in kr.scalars().all():
        sids = k.source_ids or []
        if not sids or _matches(sids) or any(s in canonical_set for s in sids):
            kpis.append(
                {
                    "id": k.id,
                    "name": k.name,
                    "definition": k.definition,
                    "dependencies": k.dependencies or {},
                    "source_ids": sids,
                }
            )
    wr = await db.execute(
        select(SourceWarmup).where(
            SourceWarmup.organization_id == scope.organization_id
        )
    )
    warmups = [
        {"text": w.text}
        for w in wr.scalars().all()
        if _matches(w.source_ids)
    ]
    fr = await db.execute(
        select(SourceFilter).where(
            SourceFilter.organization_id == scope.organization_id
        )
    )
    filters = [
        {
            "id": f.id,
            "name": f.name,
            "column": f.column,
            "kind": f.kind,
            "config": f.config or {},
            "source_ids": f.source_ids or [],
        }
        for f in fr.scalars().all()
        if _matches(f.source_ids)
    ]
    # Agent.description (workspace-wide) plus group-level instructions.
    agent_instructions = ""
    if group.agent_id:
        ar = await db.execute(
            select(Agent).where(
                Agent.id == group.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = ar.scalar_one_or_none()
        if agent:
            agent_instructions = agent.description or ""
    return OnboardingSavedResponse(
        clarifications=clarifications,
        warmup_questions=warmups,
        kpis=kpis,
        filters=filters,
        onboarding_completed_at=(
            group.onboarding_completed_at.isoformat()
            if group.onboarding_completed_at
            else None
        ),
        agent_instructions=agent_instructions,
        source_instructions=group.instructions or "",
    )


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
    # Warm-ups: pull from SourceWarmup rows scoped to this source.
    # We match on `source.id IN sw.source_ids` (the JSON list). KPIs
    # and warm-ups share this same shape; the inclusion rule is
    # "show row when its source_ids contains this source", which is
    # the most permissive and matches the user's intent that warm-ups
    # generated for source X surface whenever X is in the workspace.
    warmups: list[dict] = []
    sw_rows = await db.execute(
        select(SourceWarmup).where(
            SourceWarmup.organization_id == scope.organization_id
        )
    )
    for sw in sw_rows.scalars().all():
        sids = sw.source_ids or []
        if source.id in sids:
            warmups.append({"text": sw.text})

    # Filters: same shape rule as KPIs/warm-ups — include rows whose
    # source_ids contain this source. Cross-source filters (empty
    # source_ids) are NOT included here because the onboarding flow
    # is per-source; if you want a filter across multiple sources,
    # the filter has to be created with explicit pinning to those
    # sources.
    filters: list[dict] = []
    f_rows = await db.execute(
        select(SourceFilter).where(
            SourceFilter.organization_id == scope.organization_id
        )
    )
    for f in f_rows.scalars().all():
        sids = f.source_ids or []
        if source.id in sids:
            filters.append(
                {
                    "id": f.id,
                    "name": f.name,
                    "column": f.column,
                    "kind": f.kind,
                    "config": f.config or {},
                    "source_ids": sids,
                }
            )

    # Agent.description = workspace-wide "Specific Instructions for
    # the Agent". Surfaced so the UI can pre-fill the textarea.
    agent_instructions = ""
    if source.agent_id:
        r = await db.execute(
            select(Agent).where(
                Agent.id == source.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = r.scalar_one_or_none()
        if agent:
            agent_instructions = agent.description or ""

    # Source-scoped instructions live on the source's metadata.
    source_instructions = (source.metadata_ or {}).get(
        "onboarding_instructions", ""
    ) or ""
    completed_raw = (source.metadata_ or {}).get("onboarding_completed_at")
    return OnboardingSavedResponse(
        clarifications=clarifications,
        warmup_questions=warmups,
        kpis=kpi_rows,
        filters=filters,
        onboarding_completed_at=completed_raw,
        agent_instructions=agent_instructions,
        source_instructions=source_instructions,
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
        filters=suggestions.get("filters", []),
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

    # ---- Warm-up questions: scoped to this source ----
    # Replace-all semantics, like clarifications. Onboarding always
    # operates on a single source, so warm-ups for THIS source's
    # source_ids set are wiped and re-inserted from the body. We do
    # NOT touch warm-ups belonging to other sources or to other
    # source-sets in the same workspace.
    sw_rows = await db.execute(
        select(SourceWarmup).where(
            SourceWarmup.organization_id == scope.organization_id
        )
    )
    for sw in sw_rows.scalars().all():
        # Match the same set we'd write below — currently always
        # `[source.id]` (single-source onboarding).
        if (sw.source_ids or []) == [source.id]:
            await db.delete(sw)
    for w in body.warmup_questions:
        t = (w.text or "").strip()
        if t:
            db.add(
                SourceWarmup(
                    id=str(uuid.uuid4()),
                    organization_id=scope.organization_id,
                    source_ids=[source.id],
                    text=t,
                )
            )

    # ---- Agent-scoped instructions ----
    # `agent_instructions` is None when the caller didn't touch the
    # textarea (leave existing untouched), "" to explicitly clear,
    # or a non-empty string to set.
    if source.agent_id and body.agent_instructions is not None:
        r = await db.execute(
            select(Agent).where(
                Agent.id == source.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = r.scalar_one_or_none()
        if agent:
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

    # ---- Filters: replace-all for THIS source's set ----
    # Same semantics as warm-ups: the onboarding flow is
    # source-scoped, so we wipe filters whose source_ids match this
    # source's set and re-insert from the body. We don't touch
    # filters that span other sources — they'd have multi-element
    # source_ids that don't equal `[source.id]`.
    f_existing = await db.execute(
        select(SourceFilter).where(
            SourceFilter.organization_id == scope.organization_id
        )
    )
    for f in f_existing.scalars().all():
        if (f.source_ids or []) == [source.id]:
            await db.delete(f)
    for filt in body.filters:
        name = (filt.name or "").strip()
        col = (filt.column or "").strip()
        kind = (filt.kind or "").strip()
        if not (name and col and kind in ("date", "category")):
            continue
        sids = list(filt.source_ids or [])
        if source.id not in sids:
            sids.append(source.id)
        cfg = filt.config if isinstance(filt.config, dict) else {}
        # Sanitize config per kind so we don't persist garbage. Date
        # filters carry no values; category filters carry a list.
        if kind == "category":
            vals = cfg.get("values") or []
            if not isinstance(vals, list):
                vals = []
            cfg = {"values": [str(v) for v in vals if str(v).strip()]}
        else:
            cfg = {}
        db.add(
            SourceFilter(
                id=str(uuid.uuid4()),
                organization_id=scope.organization_id,
                source_ids=sids,
                name=name,
                column=col,
                kind=kind,
                config=cfg,
            )
        )

    # ---- Source-scoped instructions + onboarded stamp ----
    # Both live on Source.metadata_ (a JSON column), so we mutate a
    # shallow copy and reassign — SQLAlchemy doesn't pick up in-place
    # mutations on JSON columns. Only write `onboarding_instructions`
    # when the field was actually sent (not None), same semantics as
    # `agent_instructions` to avoid clobbering values set elsewhere.
    meta = dict(source.metadata_ or {})
    if body.source_instructions is not None:
        meta["onboarding_instructions"] = body.source_instructions.strip()
    meta["onboarding_completed_at"] = datetime.utcnow().isoformat()
    source.metadata_ = meta

    await db.commit()
    await db.refresh(source)
    return await _load_saved(db, scope, source)


@router.get("/agents/{agent_id}/kpis")
async def list_agent_kpis(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """KPIs relevant to a workspace's currently-active sources.

    Returns the workspace-org KPI rows whose `source_ids` overlap
    with at least one active source on this agent, plus KPIs pinned
    to no source (cross-source / conceptual). Same inclusion rule
    `dispatch_question` uses when building the LLM context, so the
    UI chips show the same KPI set the model sees.
    """
    r = await db.execute(
        select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope))
    )
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    r = await db.execute(
        select(Source).where(
            Source.agent_id == agent_id,
            tenant_filter(Source, scope),
            Source.is_active == True,  # noqa: E712
        )
    )
    active_source_ids = {s.id for s in r.scalars().all()}
    out: list[dict] = []
    rows = await db.execute(
        select(OrganizationKpi).where(
            OrganizationKpi.organization_id == scope.organization_id
        )
    )
    for k in rows.scalars().all():
        sids = k.source_ids or []
        if not sids or any(sid in active_source_ids for sid in sids):
            out.append(
                {
                    "id": k.id,
                    "name": k.name,
                    "definition": k.definition,
                }
            )
    # Stable order: by name, so the chip row doesn't shuffle on
    # every reload of the workspace.
    out.sort(key=lambda x: x["name"].lower())
    return {"kpis": out}


@router.get("/agents/{agent_id}/filters")
async def list_agent_filters(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Filters relevant to a workspace's active sources.

    Returns SourceFilter rows whose `source_ids` overlap with at
    least one active source on this agent. Cross-source filters
    (empty source_ids) are also included so a workspace-wide
    constraint surfaces even when sources change.
    """
    r = await db.execute(
        select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope))
    )
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")
    r = await db.execute(
        select(Source).where(
            Source.agent_id == agent_id,
            tenant_filter(Source, scope),
            Source.is_active == True,  # noqa: E712
        )
    )
    active_source_ids = {s.id for s in r.scalars().all()}
    rows = await db.execute(
        select(SourceFilter).where(
            SourceFilter.organization_id == scope.organization_id
        )
    )
    out: list[dict] = []
    for f in rows.scalars().all():
        sids = f.source_ids or []
        if not sids or any(sid in active_source_ids for sid in sids):
            out.append(
                {
                    "id": f.id,
                    "name": f.name,
                    "column": f.column,
                    "kind": f.kind,
                    "config": f.config or {},
                }
            )
    out.sort(key=lambda x: x["name"].lower())
    return {"filters": out}


@router.get("/agents/{agent_id}/warmup-questions")
async def list_agent_warmup_questions(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Merged warm-up questions for the workspace's chat suggestions.

    Returns the union of:
      - `agent.suggested_questions` (manually-typed, workspace-wide;
        managed via the agent-settings modal)
      - `SourceWarmup` rows whose `source_ids` overlap with the
        active sources of this workspace (i.e. anything that's
        relevant to at least one currently-active source)

    Deduped case-insensitively. Order: agent-level first (older,
    user-curated), then source-level. Both share the same chip UI,
    so the user doesn't see the distinction — they're just relevant
    questions to start the conversation with.
    """
    r = await db.execute(
        select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope))
    )
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Active sources in this workspace.
    r = await db.execute(
        select(Source).where(
            Source.agent_id == agent_id,
            tenant_filter(Source, scope),
            Source.is_active == True,  # noqa: E712
        )
    )
    active_source_ids = {s.id for s in r.scalars().all()}

    out: list[str] = []
    seen: set[str] = set()
    for q in agent.suggested_questions or []:
        if not isinstance(q, str):
            continue
        t = q.strip()
        key = t.lower()
        if t and key not in seen:
            out.append(t)
            seen.add(key)
    if active_source_ids:
        sw_rows = await db.execute(
            select(SourceWarmup).where(
                SourceWarmup.organization_id == scope.organization_id
            )
        )
        for sw in sw_rows.scalars().all():
            sids = sw.source_ids or []
            # Include if any of the warm-up's source_ids is active.
            # Same "either" rule as KPIs in dispatch_question.
            if any(sid in active_source_ids for sid in sids):
                t = (sw.text or "").strip()
                key = t.lower()
                if t and key not in seen:
                    out.append(t)
                    seen.add(key)
    return {"questions": out}


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


# --------------------------------------------------------------------- groups
#
# Endpoints below operate on a SourceGroup — a set of sources that go
# through onboarding together. The single-source path above is kept
# for backward compat (existing UI paths and integrations that opened
# the wizard from one source). New code should prefer the group
# endpoints; a single-source group is a valid degenerate case.


@router.post("/source-groups", response_model=SourceGroupResponse)
async def upsert_source_group(
    body: SourceGroupCreate,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_role("member")),
):
    """Find or create a group with this exact (agent_id, source_ids).

    Idempotent — adding the same set twice returns the same row, so
    the AddSourceModal can call this every time it finishes a batch
    without worrying about duplicates.
    """
    g = await _get_or_create_group(db, scope, body.agent_id, body.source_ids)
    await db.commit()
    return SourceGroupResponse(
        id=g.id,
        agent_id=g.agent_id,
        source_ids=g.source_ids or [],
        instructions=g.instructions or "",
        onboarding_completed_at=(
            g.onboarding_completed_at.isoformat()
            if g.onboarding_completed_at
            else None
        ),
    )


@router.post(
    "/source-groups/{group_id}/onboarding/profile",
    response_model=OnboardingProfileResponse,
)
async def group_onboarding_profile(
    group_id: str,
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_role("member")),
):
    """Build a combined profile across all members of the group and
    ask the LLM to produce suggestions that explicitly account for
    cross-source relationships.

    `body.language` mirrors the per-source endpoint.
    """
    body = body or {}
    language = body.get("language") if isinstance(body, dict) else None

    r = await db.execute(
        select(SourceGroup).where(
            SourceGroup.id == group_id,
            SourceGroup.organization_id == scope.organization_id,
        )
    )
    group = r.scalar_one_or_none()
    if not group:
        raise HTTPException(404, "Group not found")

    sources_q = await db.execute(
        select(Source).where(
            Source.id.in_(group.source_ids or []),
            tenant_filter(Source, scope),
        )
    )
    sources = list(sources_q.scalars().all())
    if not sources:
        raise HTTPException(404, "Group has no visible sources")

    profiles = [_build_source_profile(s) for s in sources]
    combined = (
        profiles[0]
        if len(profiles) == 1
        else build_multi_source_profile(profiles)
    )
    overrides = await _resolve_llm_overrides_for_agent(db, scope, group.agent_id)
    try:
        suggestions = await generate_onboarding_suggestions(
            profile=combined,
            language=language,
            llm_overrides=overrides,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            502,
            f"LLM failed to produce onboarding suggestions: {type(e).__name__}: {str(e)[:300]}",
        )
    return OnboardingProfileResponse(
        profile=combined,
        clarifications=suggestions["clarifications"],
        warmup_questions=suggestions["warmup_questions"],
        kpis=suggestions["kpis"],
        filters=suggestions.get("filters", []),
    )


@router.post(
    "/source-groups/{group_id}/onboarding/save",
    response_model=OnboardingSavedResponse,
)
async def group_onboarding_save(
    group_id: str,
    body: OnboardingSaveRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_role("member")),
):
    """Persist onboarding output for a group.

    The shape mirrors the per-source endpoint, with two semantic
    differences:

      - Warm-ups and filters are pinned to the group's canonical
        source_ids set (so a workspace where all members are active
        sees them, but other source-sets don't).
      - `source_instructions` writes to `SourceGroup.instructions`
        rather than `Source.metadata_["onboarding_instructions"]`.
        Single-source groups still flow here.
    """
    r = await db.execute(
        select(SourceGroup).where(
            SourceGroup.id == group_id,
            SourceGroup.organization_id == scope.organization_id,
        )
    )
    group = r.scalar_one_or_none()
    if not group:
        raise HTTPException(404, "Group not found")
    canonical = _canonical_source_ids(group.source_ids or [])
    if not canonical:
        raise HTTPException(400, "Group has no source members")

    # ---- Clarifications: replace-all per source.
    # Each clarification is bound to ONE source (questions about a
    # specific column live with that source). Wipe + reinsert, but
    # only for sources in this group.
    await db.execute(
        delete(SourceClarification).where(
            SourceClarification.source_id.in_(canonical),
            SourceClarification.organization_id == scope.organization_id,
        )
    )
    # Distribute clarifications across sources in round-robin order
    # if the caller didn't specify a target source. The per-source
    # save endpoint takes single source clarifications; the group
    # endpoint accepts the same shape and pins each clarification
    # to the FIRST source in the group's set (clarifications are
    # broad enough that this is fine for v1; users can re-target via
    # the per-source flow later if needed).
    primary_source = canonical[0]
    for c in body.clarifications:
        q = (c.question or "").strip()
        a = (c.answer or "").strip()
        if not (q and a):
            continue
        db.add(
            SourceClarification(
                id=str(uuid.uuid4()),
                organization_id=scope.organization_id,
                source_id=primary_source,
                question=q,
                answer=a,
            )
        )

    # ---- Warm-ups: replace-all for THIS group's source_ids set.
    sw_existing = await db.execute(
        select(SourceWarmup).where(
            SourceWarmup.organization_id == scope.organization_id
        )
    )
    for sw in sw_existing.scalars().all():
        if _canonical_source_ids(sw.source_ids or []) == canonical:
            await db.delete(sw)
    for w in body.warmup_questions:
        t = (w.text or "").strip()
        if t:
            db.add(
                SourceWarmup(
                    id=str(uuid.uuid4()),
                    organization_id=scope.organization_id,
                    source_ids=canonical,
                    text=t,
                )
            )

    # ---- KPIs: upsert by id, scoped to org.
    for k in body.kpis:
        if not (k.name.strip() and k.definition.strip()):
            continue
        sids = list(k.source_ids or canonical)
        # Ensure every member of THIS group is included so the KPI is
        # visible whenever the group is active. The user can prune
        # the list manually later.
        for s in canonical:
            if s not in sids:
                sids.append(s)
        if k.id:
            kr = await db.execute(
                select(OrganizationKpi).where(
                    OrganizationKpi.id == k.id,
                    OrganizationKpi.organization_id == scope.organization_id,
                )
            )
            existing = kr.scalar_one_or_none()
            if existing:
                existing.name = k.name.strip()
                existing.definition = k.definition.strip()
                existing.dependencies = k.dependencies or {}
                existing.source_ids = sids
                existing.updated_at = datetime.utcnow()
                continue
        db.add(
            OrganizationKpi(
                id=str(uuid.uuid4()),
                organization_id=scope.organization_id,
                name=k.name.strip(),
                definition=k.definition.strip(),
                source_ids=sids,
                dependencies=k.dependencies or {},
                created_by_user_id=scope.user.id,
            )
        )

    # ---- Filters: replace-all for THIS group's set.
    f_existing = await db.execute(
        select(SourceFilter).where(
            SourceFilter.organization_id == scope.organization_id
        )
    )
    for f in f_existing.scalars().all():
        if _canonical_source_ids(f.source_ids or []) == canonical:
            await db.delete(f)
    for filt in body.filters:
        name = (filt.name or "").strip()
        col = (filt.column or "").strip()
        kind = (filt.kind or "").strip()
        if not (name and col and kind in ("date", "category")):
            continue
        cfg = filt.config if isinstance(filt.config, dict) else {}
        if kind == "category":
            vals = cfg.get("values") or []
            if not isinstance(vals, list):
                vals = []
            cfg = {"values": [str(v) for v in vals if str(v).strip()]}
        else:
            cfg = {}
        db.add(
            SourceFilter(
                id=str(uuid.uuid4()),
                organization_id=scope.organization_id,
                source_ids=canonical,
                name=name,
                column=col,
                kind=kind,
                config=cfg,
            )
        )

    # ---- Agent-scoped instructions ----
    if group.agent_id and body.agent_instructions is not None:
        ar = await db.execute(
            select(Agent).where(
                Agent.id == group.agent_id, tenant_filter(Agent, scope)
            )
        )
        agent = ar.scalar_one_or_none()
        if agent:
            agent.description = body.agent_instructions.strip()

    # ---- Group-level instructions + onboarded stamp ----
    if body.source_instructions is not None:
        group.instructions = body.source_instructions.strip()
    group.onboarding_completed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(group)
    return await _load_saved_for_group(db, scope, group)


@router.get(
    "/source-groups/{group_id}/onboarding",
    response_model=OnboardingSavedResponse,
)
async def group_onboarding_get(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    r = await db.execute(
        select(SourceGroup).where(
            SourceGroup.id == group_id,
            SourceGroup.organization_id == scope.organization_id,
        )
    )
    group = r.scalar_one_or_none()
    if not group:
        raise HTTPException(404, "Group not found")
    return await _load_saved_for_group(db, scope, group)
