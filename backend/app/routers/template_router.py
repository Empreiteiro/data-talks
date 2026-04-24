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
from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
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
    scope: TenantScope = Depends(require_membership),
):
    """List available report templates for a source (built-in + user-created)."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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

    # Get user-created templates from DB (scoped to this workspace)
    from sqlalchemy import or_
    q = select(ReportTemplate).where(
        ReportTemplate.source_type == source.type,
        ReportTemplate.user_id == user.id,
        ReportTemplate.is_builtin == False,
        or_(
            ReportTemplate.agent_id == source.agent_id,
            ReportTemplate.agent_id == None,  # legacy templates without agent_id
        ),
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
    scope: TenantScope = Depends(require_membership),
):
    """Execute all queries in a report template against the source."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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
    scope: TenantScope = Depends(require_membership),
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
    scope: TenantScope = Depends(require_membership),
):
    """Use AI to generate a report template with SQL queries for a source."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    # Resolve LLM config
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
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
        agent_id=body.agentId,
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
    scope: TenantScope = Depends(require_membership),
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


def _build_template_report_html(
    template_name: str,
    template_description: str,
    source_name: str,
    query_sections: list[dict],
    overall_analysis: str,
) -> str:
    """Build a styled HTML report from template query results."""
    from datetime import datetime as _dt
    generated_at = _dt.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    sections_html = ""
    for section in query_sections:
        title = section.get("title", "")
        chart_b64 = section.get("chart_b64")
        explanation = section.get("explanation", "")
        table_html = section.get("table_html", "")
        error = section.get("error")

        content = ""
        if error:
            content = f'<p style="color:#f87171;">{error}</p>'
        else:
            if chart_b64:
                content += f'<img src="data:image/png;base64,{chart_b64}" style="width:100%;border-radius:8px;margin-bottom:12px;" />'
            if table_html:
                content += table_html
            if explanation:
                content += f'<p style="color:#a1a1aa;font-style:italic;margin-top:12px;font-size:0.875rem;">{explanation}</p>'

        sections_html += f'''
        <div style="background:#1a1a23;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:16px;">
            <h3 style="font-size:1rem;font-weight:600;margin:0 0 12px 0;color:#f4f4f5;">{title}</h3>
            {content}
        </div>'''

    return f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{template_name} — {source_name}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f13;color:#e4e4e7;padding:2rem;max-width:1200px;margin:0 auto}}
h1{{font-size:1.5rem;margin-bottom:4px}}
.desc{{color:#a1a1aa;font-size:0.875rem;margin-bottom:8px}}
.meta{{color:#71717a;font-size:0.75rem;margin-bottom:1.5rem}}
.analysis{{background:#1a1a23;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px}}
.analysis h2{{font-size:1.1rem;font-weight:600;margin-bottom:12px;color:#f4f4f5}}
.analysis p,.analysis li{{color:#d4d4d8;font-size:0.875rem;line-height:1.6}}
.grid{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}}
@media(max-width:768px){{.grid{{grid-template-columns:1fr}}}}
table{{width:100%;border-collapse:collapse;font-size:0.75rem;margin-top:8px}}
th{{text-align:left;padding:6px 8px;border-bottom:1px solid #3f3f46;color:#a1a1aa;font-weight:500}}
td{{padding:6px 8px;border-bottom:1px solid #27272a;color:#d4d4d8}}
.footer{{text-align:right;color:#71717a;font-size:0.75rem;margin-top:24px;padding-top:12px;border-top:1px solid #27272a}}
</style></head><body>
<h1>{template_name}</h1>
<p class="desc">{template_description}</p>
<p class="meta">{source_name} &middot; Generated {generated_at}</p>

<div class="analysis">{overall_analysis}</div>

<div class="grid">{sections_html}</div>

<p class="footer">Generated by Data Talks &middot; {generated_at}</p>
</body></html>'''


@router.post("/sources/{source_id}/templates/{template_id}/run-report")
async def run_template_as_report(
    source_id: str,
    template_id: str,
    body: RunReportRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Execute template queries and generate a styled HTML report with charts and LLM commentary."""
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import io
    import base64

    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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
            "id": tpl_row.id, "name": tpl_row.name,
            "description": tpl_row.description or "",
            "queries": tpl_row.queries or [],
            "layout": tpl_row.layout or "grid_2x2",
            "refresh_interval": tpl_row.refresh_interval or 3600,
        }

    # Resolve LLM config
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r_agent.scalar_one_or_none()
    if agent and agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_overrides_from_cfg(cfg)

    settings = get_settings()

    # Step 1: Execute template queries
    run_result = await template_executor.execute_template(
        template=template, source=source, db=db,
        user_id=user.id, organization_id=user.organization_id,
        data_files_dir=settings.data_files_dir,
    )

    lang_name = LANGUAGE_NAMES.get(body.language or "", "")
    lang_inst = f"Write in {lang_name}. " if lang_name else ""

    # Step 2: Generate overall analysis from all query results
    results_summary = []
    for res in run_result.get("results", []):
        if res.get("error"):
            results_summary.append(f"- {res['title']}: ERROR — {res['error']}")
        elif res.get("rows"):
            preview = res["rows"][:5]
            results_summary.append(f"- {res['title']}: {len(res['rows'])} rows. Sample: {json.dumps(preview, default=str)[:300]}")
        else:
            results_summary.append(f"- {res['title']}: No data")

    try:
        overall_raw, _, _ = await chat_completion(
            [
                {"role": "system", "content": (
                    f"You are a senior data analyst. {lang_inst}"
                    "Write an executive analysis of the following template report results. "
                    "Use HTML formatting: <h2> for the title, <p> for paragraphs, <ul>/<li> for key points, <strong> for emphasis. "
                    "Cover: key findings, notable patterns, and recommendations. Max 300 words."
                )},
                {"role": "user", "content": f"Template: {template.get('name', '')}\nDescription: {template.get('description', '')}\n\nQuery results:\n" + "\n".join(results_summary)},
            ],
            max_tokens=1024, llm_overrides=llm_overrides,
        )
        overall_analysis = overall_raw.strip()
    except Exception:
        overall_analysis = "<p>Analysis could not be generated.</p>"

    # Step 3: For each result, render chart + generate explanation
    query_sections = []
    chart_count = 0

    for res in run_result.get("results", []):
        section: dict = {"title": res.get("title", ""), "error": res.get("error")}

        if res.get("error") or not res.get("rows"):
            query_sections.append(section)
            continue

        rows = res["rows"]
        cols = list(rows[0].keys()) if rows else []

        # Render chart with matplotlib
        chart_b64 = None
        chart_type = "bar"
        # Find the query definition to get chart_type
        for qdef in template.get("queries", []):
            if qdef.get("id") == res.get("queryId") or qdef.get("title") == res.get("title"):
                chart_type = qdef.get("chart_type", "bar")
                break

        if len(cols) >= 2 and len(rows) > 0:
            try:
                x_vals = [str(r.get(cols[0], "")) for r in rows[:30]]
                y_vals = []
                for r in rows[:30]:
                    try:
                        y_vals.append(float(r.get(cols[1], 0) or 0))
                    except (ValueError, TypeError):
                        y_vals.append(0)

                fig, ax = plt.subplots(figsize=(8, 4))
                fig.patch.set_facecolor("#1a1a23")
                ax.set_facecolor("#1a1a23")
                ax.tick_params(colors="#a1a1aa", labelsize=8)
                ax.spines["top"].set_visible(False)
                ax.spines["right"].set_visible(False)
                ax.spines["bottom"].set_color("#3f3f46")
                ax.spines["left"].set_color("#3f3f46")

                if chart_type == "pie" and len(x_vals) <= 12:
                    ax.pie(y_vals, labels=x_vals, autopct="%1.0f%%", textprops={"color": "#e4e4e7", "fontsize": 8})
                elif chart_type == "line":
                    ax.plot(x_vals, y_vals, color="#3b82f6", linewidth=2)
                    ax.set_xticklabels(x_vals, rotation=45, ha="right", fontsize=7)
                elif chart_type == "scatter" and len(cols) >= 2:
                    ax.scatter(y_vals, y_vals, color="#3b82f6", alpha=0.7)
                else:  # bar
                    ax.bar(x_vals, y_vals, color="#3b82f6")
                    ax.set_xticklabels(x_vals, rotation=45, ha="right", fontsize=7)

                ax.set_title(res.get("title", ""), color="#f4f4f5", fontsize=10, pad=10)
                fig.tight_layout()

                buf = io.BytesIO()
                fig.savefig(buf, format="png", dpi=120, bbox_inches="tight", facecolor="#1a1a23")
                plt.close(fig)
                buf.seek(0)
                chart_b64 = base64.b64encode(buf.read()).decode("utf-8")
                chart_count += 1
            except Exception:
                chart_b64 = None

        section["chart_b64"] = chart_b64

        # Data table (max 15 rows)
        if rows:
            table_rows = rows[:15]
            th = "".join(f"<th>{c}</th>" for c in cols)
            tbody = "".join(
                "<tr>" + "".join(f"<td>{r.get(c, '')}</td>" for c in cols) + "</tr>"
                for r in table_rows
            )
            section["table_html"] = f"<table><thead><tr>{th}</tr></thead><tbody>{tbody}</tbody></table>"

        # Per-query explanation
        try:
            expl_raw, _, _ = await chat_completion(
                [
                    {"role": "system", "content": f"You are a data analyst. {lang_inst}Provide a 2-3 sentence insight about this query result. Be specific and actionable."},
                    {"role": "user", "content": f"Query: {res.get('title', '')}\nData ({len(rows)} rows): {json.dumps(rows[:10], default=str)[:500]}"},
                ],
                max_tokens=256, llm_overrides=llm_overrides,
            )
            section["explanation"] = expl_raw.strip()
        except Exception:
            section["explanation"] = ""

        query_sections.append(section)

    # Step 4: Assemble HTML
    html_content = _build_template_report_html(
        template_name=template.get("name", "Report"),
        template_description=template.get("description", ""),
        source_name=source.name,
        query_sections=query_sections,
        overall_analysis=overall_analysis,
    )

    # Step 5: Save as Report
    report_id = str(uuid.uuid4())
    report = Report(
        id=report_id,
        user_id=user.id,
        agent_id=body.agentId,
        source_id=source.id,
        source_name=f"{source.name} — {template.get('name', 'Template')}",
        template_id=template_id,
        html_content=html_content,
        chart_count=chart_count,
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


@router.get("/sources/{source_id}/templates/{template_id}/reports")
async def list_template_reports(
    source_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """List reports generated from a specific template."""
    r = await db.execute(
        select(Report)
        .where(Report.template_id == template_id, Report.user_id == user.id)
        .order_by(Report.created_at.desc())
        .limit(20)
    )
    reports = r.scalars().all()
    return [
        {
            "id": rpt.id,
            "sourceName": rpt.source_name,
            "chartCount": rpt.chart_count,
            "createdAt": rpt.created_at.isoformat(),
        }
        for rpt in reports
    ]


class UpdateQueriesRequest(BaseModel):
    queries: list[dict]


@router.patch("/sources/{source_id}/templates/{template_id}/queries")
async def update_template_queries(
    source_id: str,
    template_id: str,
    body: UpdateQueriesRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Update the queries array of a user-created template."""
    r = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id,
            ReportTemplate.user_id == user.id,
            ReportTemplate.is_builtin == False,
        )
    )
    tpl = r.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Template not found or is built-in (read-only)")
    # Ensure each query has an id
    for i, q in enumerate(body.queries):
        if "id" not in q:
            q["id"] = f"q{i+1}"
    tpl.queries = body.queries
    await db.commit()
    await db.refresh(tpl)
    return {"queries": tpl.queries, "queryCount": len(tpl.queries or [])}


class AddQueryRequest(BaseModel):
    agentId: str
    description: str
    language: Optional[str] = None


@router.post("/sources/{source_id}/templates/{template_id}/add-query")
async def add_query_to_template(
    source_id: str,
    template_id: str,
    body: AddQueryRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Use AI to generate a new query and add it to the template."""
    r_src = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r_src.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")

    r_tpl = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id,
            ReportTemplate.user_id == user.id,
            ReportTemplate.is_builtin == False,
        )
    )
    tpl = r_tpl.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Template not found or is built-in (read-only)")

    # Resolve LLM
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r_agent.scalar_one_or_none()
    if agent and agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_overrides_from_cfg(cfg)

    # Build schema context
    meta = source.metadata_ or {}
    existing_titles = [q.get("title", "") for q in (tpl.queries or [])]

    lang_name = LANGUAGE_NAMES.get(body.language or "", "")
    lang_inst = f"Write the title in {lang_name}. " if lang_name else ""

    system = (
        "You are a data analyst. Generate a SINGLE SQL query for a report template.\n"
        f"{lang_inst}"
        "Return ONLY valid JSON:\n"
        '{"title": "...", "sql": "SELECT ...", "chart_type": "bar"}\n'
        'chart_type: bar, line, pie, histogram, scatter.\n'
        "For CSV sources, the table is 'data'. Quote column names with double quotes if needed."
    )
    user_msg = f"Source: {source.name} ({source.type})\nExisting queries: {', '.join(existing_titles)}\n\nUser request: {body.description}"

    try:
        raw, _usage, _trace = await chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            max_tokens=1024, llm_overrides=llm_overrides,
        )
    except Exception as exc:
        raise HTTPException(400, f"LLM error: {exc}")

    # Parse
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].strip() == "```": lines = lines[:-1]
        text = "\n".join(lines)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise HTTPException(500, "Failed to parse LLM response")
    parsed = json.loads(text[start:end+1])

    new_query = {
        "id": f"q{len(tpl.queries or []) + 1}",
        "title": parsed.get("title", "New Query"),
        "sql": parsed.get("sql", ""),
        "chart_type": parsed.get("chart_type", "bar"),
        "chart_config": {},
    }

    queries = list(tpl.queries or [])
    queries.append(new_query)
    tpl.queries = queries
    await db.commit()
    await db.refresh(tpl)
    return {"query": new_query, "queryCount": len(tpl.queries or [])}


class RunWithCommentaryRequest(BaseModel):
    agentId: str
    language: Optional[str] = None
    filters: Optional[dict] = None
    dateRange: Optional[dict] = None
    disabledQueries: Optional[list[str]] = None


@router.post("/sources/{source_id}/templates/{template_id}/run-with-commentary")
async def run_template_with_commentary(
    source_id: str,
    template_id: str,
    body: RunWithCommentaryRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Execute template queries then generate AI commentary per result."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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
            "id": tpl_row.id, "name": tpl_row.name,
            "queries": tpl_row.queries or [], "layout": tpl_row.layout,
            "refresh_interval": tpl_row.refresh_interval,
        }

    # Resolve LLM
    llm_overrides = None
    r_agent = await db.execute(select(Agent).where(Agent.id == body.agentId, tenant_filter(Agent, scope)))
    agent = r_agent.scalar_one_or_none()
    if agent and agent.llm_config_id:
        r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
        cfg = r_cfg.scalar_one_or_none()
        if cfg:
            llm_overrides = _llm_overrides_from_cfg(cfg)

    settings = get_settings()

    # Execute queries
    run_result = await template_executor.execute_template(
        template=template, source=source, db=db,
        user_id=user.id, organization_id=user.organization_id,
        filters=body.filters, date_range=body.dateRange,
        disabled_queries=body.disabledQueries,
        data_files_dir=settings.data_files_dir,
    )

    # Generate commentary per result
    lang_name = LANGUAGE_NAMES.get(body.language or "", "")
    lang_inst = f"Write in {lang_name}. " if lang_name else ""

    for res in run_result.get("results", []):
        if res.get("error") or not res.get("rows"):
            res["explanation"] = None
            continue
        rows_preview = res["rows"][:10]
        try:
            raw, _, _ = await chat_completion(
                [
                    {"role": "system", "content": f"You are a data analyst. {lang_inst}Given query results, provide a 2-3 sentence business insight. Be concise and specific."},
                    {"role": "user", "content": f"Query: {res.get('title', '')}\nData (first rows):\n{json.dumps(rows_preview, default=str)}"},
                ],
                max_tokens=256, llm_overrides=llm_overrides,
            )
            res["explanation"] = raw.strip()
        except Exception:
            res["explanation"] = None

    return run_result


@router.put("/sources/{source_id}/templates/{template_id}/customize")
async def customize_template(
    source_id: str,
    template_id: str,
    body: TemplateRunRequest,
    db: AsyncSession = Depends(get_db),
    scope: TenantScope = Depends(require_membership),
):
    """Save user customizations for a built-in template (creates a user copy in DB)."""
    # Verify source ownership
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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
    scope: TenantScope = Depends(require_membership),
):
    """Reset user customizations for a template (delete the user copy)."""
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
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
