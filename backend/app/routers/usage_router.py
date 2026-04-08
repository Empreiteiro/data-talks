"""Usage Analytics API — token consumption, cost estimation, and usage reports."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_user
from app.database import get_db
from app.models import User, PlatformLog

router = APIRouter(prefix="/usage", tags=["usage"])

# Approximate cost per 1M tokens (input/output) by provider/model
PRICING = {
    "openai": {"input": 0.15, "output": 0.60},      # gpt-4o-mini default
    "anthropic": {"input": 3.00, "output": 15.00},   # claude-sonnet
    "google": {"input": 0.075, "output": 0.30},      # gemini-flash
    "ollama": {"input": 0.0, "output": 0.0},         # local, free
    "litellm": {"input": 0.15, "output": 0.60},      # depends on backend
    "claude-code": {"input": 0.0, "output": 0.0},    # CLI, uses OAuth
}


def _estimate_cost(provider: str, input_tokens: int, output_tokens: int) -> float:
    rates = PRICING.get(provider, PRICING["openai"])
    return round((input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000, 4)


@router.get("/summary")
async def usage_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Get overall usage summary for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)

    # Total tokens
    r = await db.execute(
        select(
            func.count(PlatformLog.id).label("total_calls"),
            func.coalesce(func.sum(PlatformLog.input_tokens), 0).label("total_input"),
            func.coalesce(func.sum(PlatformLog.output_tokens), 0).label("total_output"),
        ).where(PlatformLog.created_at >= since)
    )
    row = r.one()
    total_input = int(row.total_input)
    total_output = int(row.total_output)

    return {
        "period_days": days,
        "total_calls": int(row.total_calls),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_input + total_output,
        "estimated_cost_usd": _estimate_cost("openai", total_input, total_output),
    }


@router.get("/by-provider")
async def usage_by_provider(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Usage breakdown by LLM provider."""
    since = datetime.utcnow() - timedelta(days=days)

    r = await db.execute(
        select(
            PlatformLog.provider,
            func.count(PlatformLog.id).label("calls"),
            func.coalesce(func.sum(PlatformLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(PlatformLog.output_tokens), 0).label("output_tokens"),
        )
        .where(PlatformLog.created_at >= since)
        .group_by(PlatformLog.provider)
        .order_by(func.sum(PlatformLog.input_tokens + PlatformLog.output_tokens).desc())
    )
    rows = r.all()
    return [
        {
            "provider": row.provider,
            "calls": int(row.calls),
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "total_tokens": int(row.input_tokens) + int(row.output_tokens),
            "estimated_cost_usd": _estimate_cost(row.provider, int(row.input_tokens), int(row.output_tokens)),
        }
        for row in rows
    ]


@router.get("/by-action")
async def usage_by_action(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Usage breakdown by action type (pergunta, summary, etc.)."""
    since = datetime.utcnow() - timedelta(days=days)

    r = await db.execute(
        select(
            PlatformLog.action,
            PlatformLog.channel,
            func.count(PlatformLog.id).label("calls"),
            func.coalesce(func.sum(PlatformLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(PlatformLog.output_tokens), 0).label("output_tokens"),
        )
        .where(PlatformLog.created_at >= since)
        .group_by(PlatformLog.action, PlatformLog.channel)
        .order_by(func.sum(PlatformLog.input_tokens + PlatformLog.output_tokens).desc())
    )
    rows = r.all()
    return [
        {
            "action": row.action,
            "channel": row.channel,
            "calls": int(row.calls),
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "total_tokens": int(row.input_tokens) + int(row.output_tokens),
        }
        for row in rows
    ]


@router.get("/by-model")
async def usage_by_model(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Usage breakdown by model."""
    since = datetime.utcnow() - timedelta(days=days)

    r = await db.execute(
        select(
            PlatformLog.provider,
            PlatformLog.model,
            func.count(PlatformLog.id).label("calls"),
            func.coalesce(func.sum(PlatformLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(PlatformLog.output_tokens), 0).label("output_tokens"),
        )
        .where(PlatformLog.created_at >= since)
        .group_by(PlatformLog.provider, PlatformLog.model)
        .order_by(func.sum(PlatformLog.input_tokens + PlatformLog.output_tokens).desc())
    )
    rows = r.all()
    return [
        {
            "provider": row.provider,
            "model": row.model,
            "calls": int(row.calls),
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "total_tokens": int(row.input_tokens) + int(row.output_tokens),
            "estimated_cost_usd": _estimate_cost(row.provider, int(row.input_tokens), int(row.output_tokens)),
        }
        for row in rows
    ]


@router.get("/daily")
async def usage_daily(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Daily token consumption for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)

    r = await db.execute(
        select(
            func.date(PlatformLog.created_at).label("day"),
            func.count(PlatformLog.id).label("calls"),
            func.coalesce(func.sum(PlatformLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(PlatformLog.output_tokens), 0).label("output_tokens"),
        )
        .where(PlatformLog.created_at >= since)
        .group_by(func.date(PlatformLog.created_at))
        .order_by(func.date(PlatformLog.created_at))
    )
    rows = r.all()
    return [
        {
            "day": str(row.day),
            "calls": int(row.calls),
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "total_tokens": int(row.input_tokens) + int(row.output_tokens),
        }
        for row in rows
    ]
