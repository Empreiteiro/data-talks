"""
Report Templates: browse, execute, and customize pre-configured report templates for data sources.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Source, ReportTemplate, ReportTemplateRun
from app.auth import require_user
from app.schemas import TemplateRunRequest
from app.services import template_registry, template_executor

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("/sources/{source_id}/templates")
async def list_templates(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """List available report templates for a source (built-in + user-created)."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Get built-in templates matching source type
    builtin = template_registry.list_templates(source.type)
    results = []
    for tpl in builtin:
        results.append({
            "id": tpl["id"],
            "name": tpl.get("name", ""),
            "sourceType": tpl.get("source_type", ""),
            "description": tpl.get("description", ""),
            "queries": tpl.get("queries", []),
            "layout": tpl.get("layout", "grid_2x2"),
            "refreshInterval": tpl.get("refresh_interval", 3600),
            "isBuiltin": True,
            "queryCount": len(tpl.get("queries", [])),
        })

    # Get user-created templates from DB
    q = select(ReportTemplate).where(
        ReportTemplate.source_type == source.type,
        ReportTemplate.user_id == user.id,
        ReportTemplate.is_builtin == False,
    )
    r = await db.execute(q)
    user_templates = r.scalars().all()
    for tpl in user_templates:
        queries = tpl.queries or []
        results.append({
            "id": tpl.id,
            "name": tpl.name,
            "sourceType": tpl.source_type,
            "description": tpl.description or "",
            "queries": queries,
            "layout": tpl.layout,
            "refreshInterval": tpl.refresh_interval,
            "isBuiltin": False,
            "queryCount": len(queries),
        })

    return results


@router.post("/sources/{source_id}/templates/{template_id}/run")
async def run_template(
    source_id: str,
    template_id: str,
    body: Optional[TemplateRunRequest] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Execute all queries in a report template against the source."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Try built-in first, then DB
    template = template_registry.get_template(template_id)
    if not template:
        r = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
        tpl_row = r.scalar_one_or_none()
        if not tpl_row:
            raise HTTPException(404, "Template not found")
        template = {
            "id": tpl_row.id,
            "name": tpl_row.name,
            "source_type": tpl_row.source_type,
            "description": tpl_row.description,
            "queries": tpl_row.queries or [],
            "layout": tpl_row.layout,
            "refresh_interval": tpl_row.refresh_interval,
        }

    filters = body.filters if body else None
    date_range = body.dateRange if body else None
    disabled_queries = body.disabledQueries if body else None

    try:
        result = await template_executor.execute_template(
            template=template,
            source=source,
            db=db,
            user_id=user.id,
            organization_id=user.organization_id,
            filters=filters,
            date_range=date_range,
            disabled_queries=disabled_queries,
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Template execution failed")
        raise HTTPException(500, f"Template execution failed: {exc}")

    return result


@router.get("/sources/{source_id}/templates/{template_id}/runs")
async def list_template_runs(
    source_id: str,
    template_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """List execution history for a template on a specific source."""
    q = (
        select(ReportTemplateRun)
        .where(
            ReportTemplateRun.source_id == source_id,
            ReportTemplateRun.template_id == template_id,
            ReportTemplateRun.user_id == user.id,
        )
        .order_by(ReportTemplateRun.created_at.desc())
        .limit(limit)
    )
    r = await db.execute(q)
    runs = r.scalars().all()
    return [
        {
            "runId": run.id,
            "templateId": run.template_id,
            "status": run.status,
            "durationMs": run.duration_ms,
            "createdAt": run.created_at.isoformat(),
        }
        for run in runs
    ]


@router.put("/sources/{source_id}/templates/{template_id}/customize")
async def customize_template(
    source_id: str,
    template_id: str,
    body: TemplateRunRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Save user customizations for a built-in template (creates a user copy in DB)."""
    # Verify source ownership
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Get the original template
    original = template_registry.get_template(template_id)
    if not original:
        raise HTTPException(404, "Template not found")

    # Check if user already has a customization
    q = select(ReportTemplate).where(
        ReportTemplate.user_id == user.id,
        ReportTemplate.source_type == source.type,
        ReportTemplate.name == original.get("name", ""),
        ReportTemplate.is_builtin == False,
    )
    r = await db.execute(q)
    existing = r.scalar_one_or_none()

    # Filter out disabled queries
    queries = original.get("queries", [])
    if body.disabledQueries:
        queries = [q for q in queries if q.get("id") not in body.disabledQueries]

    if existing:
        existing.queries = queries
        existing.updated_at = __import__("datetime").datetime.utcnow()
    else:
        new_tpl = ReportTemplate(
            id=str(uuid.uuid4()),
            user_id=user.id,
            organization_id=user.organization_id,
            source_type=source.type,
            name=original.get("name", ""),
            description=original.get("description", ""),
            queries=queries,
            layout=original.get("layout", "grid_2x2"),
            refresh_interval=original.get("refresh_interval", 3600),
            is_builtin=False,
        )
        db.add(new_tpl)

    await db.commit()
    return {"ok": True}


@router.delete("/sources/{source_id}/templates/{template_id}/customize")
async def reset_template_customization(
    source_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Reset user customizations for a template (delete the user copy)."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    original = template_registry.get_template(template_id)
    if not original:
        raise HTTPException(404, "Template not found")

    q = select(ReportTemplate).where(
        ReportTemplate.user_id == user.id,
        ReportTemplate.source_type == source.type,
        ReportTemplate.name == original.get("name", ""),
        ReportTemplate.is_builtin == False,
    )
    r = await db.execute(q)
    existing = r.scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()

    return {"ok": True}
