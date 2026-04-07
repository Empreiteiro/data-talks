"""
Report Templates: browse, execute, customize, and AI-generate report templates for data sources.
"""
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Source, Agent, Report, ReportTemplate, ReportTemplateRun, LlmConfig, LlmSettings
from app.auth import require_user
from app.config import get_settings
from app.schemas import TemplateRunRequest
from app.services import template_registry, template_executor
from app.llm.client import chat_completion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["templates"])


def _llm_overrides_from_cfg(cfg: LlmConfig | LlmSettings | None) -> dict | None:
    if not cfg:
        return None
    overrides: dict[str, Any] = {}
    for attr in ("llm_provider", "openai_api_key", "openai_base_url", "openai_model",
                 "ollama_base_url", "ollama_model", "litellm_base_url", "litellm_model",
                 "litellm_api_key", "claude_code_model", "claude_code_oauth_token"):
        val = getattr(cfg, attr, None)
        if val:
            overrides[attr] = val
    return overrides or None


LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


class GenerateTemplateRequest(BaseModel):
    agentId: str
    prompt: Optional[str] = None
    language: Optional[str] = None


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
        settings = get_settings()
        result = await template_executor.execute_template(
            template=template,
            source=source,
            db=db,
            user_id=user.id,
            organization_id=user.organization_id,
            filters=filters,
            date_range=date_range,
            disabled_queries=disabled_queries,
            data_files_dir=settings.data_files_dir,
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


@router.post("/sources/{source_id}/generate")
async def generate_template(
    source_id: str,
    body: GenerateTemplateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Use AI to generate a report template with SQL queries for a source."""
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Resolve LLM config
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId))
    agent = r_agent.scalar_one_or_none()
    if agent and agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_overrides_from_cfg(cfg)

    # Build schema context from source metadata
    meta = source.metadata_ or {}
    schema_lines: list[str] = []

    if source.type in ("csv", "xlsx"):
        columns = meta.get("columns", [])
        profile = meta.get("sample_profile", {})
        schema_lines.append(f"Table: data (CSV, {meta.get('row_count', '?')} rows)")
        for col in columns:
            col_info = profile.get("columns", {}).get(col, {})
            dtype = col_info.get("type", "unknown")
            schema_lines.append(f"  - {col} ({dtype})")
    elif source.type == "sql_database":
        for ti in meta.get("table_infos", []):
            table_name = ti.get("table", ti.get("name", "?"))
            schema_lines.append(f"Table: {table_name}")
            for c in ti.get("columns", []):
                cname = c.get("name", c) if isinstance(c, dict) else c
                ctype = c.get("type", "") if isinstance(c, dict) else ""
                schema_lines.append(f"  - {cname} {ctype}".strip())
    elif source.type == "bigquery":
        for ti in meta.get("table_infos", []):
            table_name = ti.get("table", "?")
            schema_lines.append(f"Table: {table_name}")
            for c in ti.get("columns", []):
                cname = c.get("name", c) if isinstance(c, dict) else c
                ctype = c.get("type", "") if isinstance(c, dict) else ""
                schema_lines.append(f"  - {cname} {ctype}".strip())
    else:
        columns = meta.get("columns", [])
        if columns:
            schema_lines.append(f"Table: data ({source.type})")
            for col in columns:
                schema_lines.append(f"  - {col}")

    if not schema_lines:
        raise HTTPException(400, "Could not extract schema from source metadata")

    schema_text = "\n".join(schema_lines)
    lang_name = LANGUAGE_NAMES.get(body.language or "", "")
    lang_instruction = f"Write ALL text (template name, description, query titles) in {lang_name}. " if lang_name else ""

    system = (
        "You are a data analyst. Given a database schema, create a report template with 3-6 SQL queries "
        "that provide useful analytical insights. Each query should produce data suitable for charting.\n\n"
        f"{lang_instruction}"
        "Return ONLY valid JSON in this format:\n"
        '{\n'
        '  "name": "Template name",\n'
        '  "description": "One-line description",\n'
        '  "queries": [\n'
        '    {\n'
        '      "title": "Query title",\n'
        '      "sql": "SELECT ... FROM ...",\n'
        '      "chart_type": "bar"\n'
        '    }\n'
        '  ],\n'
        '  "layout": "grid_2x2"\n'
        '}\n\n'
        "chart_type must be one of: bar, line, pie, histogram, scatter.\n"
        "For CSV sources, the table name is 'data'. Quote column names with double quotes if they have spaces."
    )

    user_msg = f"Source: {source.name} ({source.type})\n\nSchema:\n{schema_text}"
    if body.prompt:
        user_msg += f"\n\nUser request: {body.prompt}"

    try:
        raw, usage, _trace = await chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            max_tokens=2048,
            llm_overrides=llm_overrides,
        )
    except Exception as exc:
        raise HTTPException(400, f"LLM error: {exc}")

    # Parse JSON
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise HTTPException(500, "Failed to parse LLM response as JSON")
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        raise HTTPException(500, "Failed to parse LLM response as JSON")

    queries = parsed.get("queries", [])
    for i, q in enumerate(queries):
        if "id" not in q:
            q["id"] = f"q{i+1}"
        if "chart_config" not in q:
            q["chart_config"] = {}

    tpl = ReportTemplate(
        id=str(uuid.uuid4()),
        user_id=user.id,
        organization_id=user.organization_id,
        source_type=source.type,
        name=parsed.get("name", "AI-Generated Template"),
        description=parsed.get("description", ""),
        queries=queries,
        layout=parsed.get("layout", "grid_2x2"),
        refresh_interval=3600,
        is_builtin=False,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)

    return {
        "id": tpl.id,
        "name": tpl.name,
        "sourceType": tpl.source_type,
        "description": tpl.description or "",
        "queries": tpl.queries,
        "layout": tpl.layout,
        "refreshInterval": tpl.refresh_interval,
        "isBuiltin": False,
        "queryCount": len(tpl.queries or []),
    }


@router.delete("/sources/{source_id}/templates/{template_id}")
async def delete_template(
    source_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Delete a user-created template."""
    r = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id,
            ReportTemplate.user_id == user.id,
            ReportTemplate.is_builtin == False,
        )
    )
    tpl = r.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Template not found or is built-in")
    await db.delete(tpl)
    await db.commit()
    return {"ok": True}


class RunReportRequest(BaseModel):
    agentId: str
    language: Optional[str] = None


@router.post("/sources/{source_id}/templates/{template_id}/run-report")
async def run_template_as_report(
    source_id: str,
    template_id: str,
    body: RunReportRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Run a template and generate a full HTML report with charts and LLM commentary."""
    from app.scripts.report_generator import generate_report as gen_report
    import pandas as pd

    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Resolve template
    template = template_registry.get_template(template_id)
    if not template:
        r_tpl = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
        tpl_row = r_tpl.scalar_one_or_none()
        if not tpl_row:
            raise HTTPException(404, "Template not found")
        template = {
            "id": tpl_row.id,
            "name": tpl_row.name,
            "queries": tpl_row.queries or [],
        }

    # Resolve LLM config
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId))
    agent = r_agent.scalar_one_or_none()
    if agent and agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_overrides_from_cfg(cfg)

    settings = get_settings()
    meta = source.metadata_ or {}
    source_type = source.type or ""

    # Load the source data into a DataFrame (same as report_csv)
    if source_type in ("csv", "xlsx", "parquet", "json"):
        file_path = meta.get("file_path", "")
        full_path = Path(settings.data_files_dir) / file_path
        if not full_path.exists():
            raise HTTPException(400, f"Source file not found: {file_path}")
        ext = full_path.suffix.lower()
        if ext == ".csv":
            df = pd.read_csv(full_path, nrows=100_000)
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(full_path, nrows=100_000)
        elif ext == ".parquet":
            df = pd.read_parquet(full_path)
        elif ext == ".json":
            df = pd.read_json(full_path)
        else:
            df = pd.read_csv(full_path, nrows=100_000)
    elif source_type == "sql_database":
        conn_str = meta.get("connectionString") or meta.get("connection_string", "")
        # Load from first table
        table_infos = meta.get("table_infos", [])
        table_name = table_infos[0].get("table", table_infos[0].get("name", "")) if table_infos else ""
        if not conn_str or not table_name:
            raise HTTPException(400, "SQL source missing connection info")
        from sqlalchemy import create_engine
        eng = create_engine(conn_str)
        df = pd.read_sql_table(table_name, eng)
        if len(df) > 100_000:
            df = df.head(100_000)
    else:
        raise HTTPException(400, f"Report generation not supported for source type: {source_type}")

    try:
        result = await gen_report(
            df=df,
            source_name=f"{source.name} — {template.get('name', 'Template')}",
            llm_overrides=llm_overrides,
            channel="studio",
            language=body.language,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("Template report generation failed")
        raise HTTPException(500, f"Report generation failed: {exc}")

    # Save as a Report (same model as Exploratory Report) for future viewing
    report_id = str(uuid.uuid4())
    report = Report(
        id=report_id,
        user_id=user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=f"{source.name} — {template.get('name', 'Template')}",
        html_content=result["html_content"],
        chart_count=result.get("chart_count", 0),
    )
    db.add(report)
    await db.commit()

    return {
        "id": report.id,
        "agentId": report.agent_id,
        "sourceId": report.source_id,
        "sourceName": report.source_name,
        "chartCount": report.chart_count,
        "createdAt": report.created_at.isoformat(),
    }


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
