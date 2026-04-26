"""Medallion Architecture API — Bronze / Silver / Gold layer management."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_user
from app.config import get_settings
from app.database import get_db
from app.models import (
    User, Source, Agent, MedallionLayer, MedallionBuildLog,
    LlmConfig, LlmSettings,
)
from app.schemas import (
    BronzeGenerateRequest, SilverSuggestRequest, SilverApplyRequest,
    GoldSuggestRequest, GoldApplyRequest,
)
from app.services import medallion_service as svc

router = APIRouter(prefix="/medallion", tags=["medallion"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_source(source_id: str, scope: TenantScope, db: AsyncSession) -> Source:
    result = await db.execute(
        select(Source).where(Source.id == source_id, tenant_filter(Source, scope))
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    return source


async def _resolve_llm_overrides(
    agent_id: str, scope: TenantScope, db: AsyncSession
) -> dict | None:
    """Load LLM config for the agent's user, following the same logic as ask.py."""
    from app.routers.ask import _llm_config_to_overrides

    # Try agent-specific config
    result = await db.execute(
        select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope))
    )
    agent = result.scalar_one_or_none()
    if agent and agent.llm_config_id:
        cfg_result = await db.execute(
            select(LlmConfig).where(
                LlmConfig.id == agent.llm_config_id,
                LlmConfig.user_id == scope.user.id,
            )
        )
        cfg = cfg_result.scalar_one_or_none()
        if cfg:
            return _llm_config_to_overrides(cfg)

    # Fallback 1: user's default LlmConfig (the one with is_default=True).
    # This is what makes a workspace with NO config selected still work
    # — the user picked a sensible default in Account → LLM, we honor it.
    default_result = await db.execute(
        select(LlmConfig).where(
            LlmConfig.user_id == scope.user.id,
            LlmConfig.is_default == True,  # noqa: E712
        ).limit(1)
    )
    default_cfg = default_result.scalar_one_or_none()
    if default_cfg:
        return _llm_config_to_overrides(default_cfg)

    # Fallback 2: legacy LlmSettings (single-row table predating
    # LlmConfig). Kept so old setups don't break.
    settings_result = await db.execute(
        select(LlmSettings).where(LlmSettings.user_id == scope.user.id)
    )
    settings = settings_result.scalar_one_or_none()
    return _llm_config_to_overrides(settings)


def _layer_out(d: dict) -> dict:
    """Passthrough — service already returns camelCase dict."""
    return d


def _log_out(d: dict) -> dict:
    return d


# ---------------------------------------------------------------------------
# List layers & logs
# ---------------------------------------------------------------------------

@router.get("/sources/{source_id}/layers")
async def list_layers(
    source_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    await _get_source(source_id, scope, db)
    result = await db.execute(
        select(MedallionLayer)
        .where(MedallionLayer.source_id == source_id, MedallionLayer.user_id == scope.user.id)
        .order_by(MedallionLayer.created_at)
    )
    layers = result.scalars().all()
    return [svc._layer_to_dict(l) for l in layers]


@router.get("/sources/{source_id}/logs")
async def list_logs(
    source_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    await _get_source(source_id, scope, db)
    result = await db.execute(
        select(MedallionBuildLog)
        .where(MedallionBuildLog.source_id == source_id, MedallionBuildLog.user_id == scope.user.id)
        .order_by(MedallionBuildLog.created_at.desc())
    )
    logs = result.scalars().all()
    return [svc._log_to_dict(entry) for entry in logs]


@router.get("/layers/{layer_id}")
async def get_layer(
    layer_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.id == layer_id, MedallionLayer.user_id == scope.user.id
        )
    )
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(404, "Layer not found")
    return svc._layer_to_dict(layer)


# ---------------------------------------------------------------------------
# Bronze
# ---------------------------------------------------------------------------

@router.post("/bronze/generate")
async def generate_bronze(
    body: BronzeGenerateRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_source(body.sourceId, scope, db)
    settings = get_settings()
    try:
        layer = await svc.generate_bronze(
            source, scope.user.id, body.agentId, settings.data_files_dir, db
        )
        return layer
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Silver — suggest & apply
# ---------------------------------------------------------------------------

@router.post("/silver/suggest")
async def suggest_silver(
    body: SilverSuggestRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_source(body.sourceId, scope, db)
    settings = get_settings()
    llm_overrides = await _resolve_llm_overrides(body.agentId, scope, db)
    try:
        result = await svc.suggest_silver(
            source, scope.user.id, body.agentId, settings.data_files_dir, db,
            llm_overrides=llm_overrides,
            feedback=body.feedback,
        )
        return result
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/silver/apply")
async def apply_silver(
    body: SilverApplyRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_source(body.sourceId, scope, db)
    settings = get_settings()
    try:
        layer = await svc.apply_silver(
            source, scope.user.id, body.agentId, settings.data_files_dir, db,
            build_log_id=body.buildLogId,
            config=body.config,
        )
        return layer
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Gold — suggest & apply
# ---------------------------------------------------------------------------

@router.post("/gold/suggest")
async def suggest_gold(
    body: GoldSuggestRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_source(body.sourceId, scope, db)
    settings = get_settings()
    llm_overrides = await _resolve_llm_overrides(body.agentId, scope, db)
    try:
        result = await svc.suggest_gold(
            source, scope.user.id, body.agentId, settings.data_files_dir, db,
            llm_overrides=llm_overrides,
            feedback=body.feedback,
            report_prompt=body.reportPrompt,
        )
        return result
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/gold/apply")
async def apply_gold(
    body: GoldApplyRequest,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_source(body.sourceId, scope, db)
    settings = get_settings()
    try:
        layers = await svc.apply_gold(
            source, scope.user.id, body.agentId, settings.data_files_dir, db,
            build_log_id=body.buildLogId,
            selected_tables=body.selectedTables,
        )
        return {"layers": layers, "totalRows": sum(l.get("rowCount", 0) or 0 for l in layers)}
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Delete layer
# ---------------------------------------------------------------------------

@router.delete("/layers/{layer_id}")
async def delete_layer(
    layer_id: str,
    scope: TenantScope = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.id == layer_id, MedallionLayer.user_id == scope.user.id
        )
    )
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(404, "Layer not found")

    # Cascade: if deleting bronze, also delete silver+gold; if silver, delete gold
    if layer.layer in ("bronze", "silver"):
        cascade_layers = ["gold"] if layer.layer == "silver" else ["silver", "gold"]
        cascade_result = await db.execute(
            select(MedallionLayer).where(
                MedallionLayer.source_id == layer.source_id,
                MedallionLayer.layer.in_(cascade_layers),
            )
        )
        for cl in cascade_result.scalars().all():
            await db.delete(cl)

    await db.delete(layer)
    await db.flush()
    return {"ok": True}
