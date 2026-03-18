"""
Template Executor: runs all queries in a report template against a data source.
"""
import asyncio
import hashlib
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ReportTemplateRun

logger = logging.getLogger(__name__)

MAX_ROWS_FETCH = 500

# Simple in-memory TTL cache: (cache_key) -> (result, expiry_timestamp)
_result_cache: dict[str, tuple[list[dict], float]] = {}


def _run_query_sync(connection_string: str, query: str) -> list[dict]:
    """Execute a SELECT query synchronously and return rows."""
    from sqlalchemy import create_engine, text

    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")

    engine = create_engine(connection_string)
    with engine.connect() as conn:
        result = conn.execute(text(query))
        rows = result.mappings().fetchmany(MAX_ROWS_FETCH)
    return [dict(r) for r in rows]


def _resolve_sql_placeholders(sql: str, source_meta: dict, filters: dict | None = None) -> str:
    """Replace {{placeholder}} tokens in SQL with actual values from source metadata and filters."""
    result = sql
    # Source metadata placeholders
    for key, val in source_meta.items():
        result = result.replace("{{" + key + "}}", str(val))
    # Filter placeholders
    if filters:
        for key, val in filters.items():
            result = result.replace("{{" + key + "}}", str(val))
    return result


def _build_chart_spec(rows: list[dict], query_def: dict) -> dict | None:
    """Build a frontend-compatible ChartSpec from query results and chart config."""
    if not rows:
        return None

    chart_type = query_def.get("chart_type", "bar")
    chart_config = query_def.get("chart_config", {})
    title = query_def.get("title", "")

    # Determine x and y keys from chart_config or auto-detect
    columns = list(rows[0].keys()) if rows else []
    x_key = chart_config.get("xKey") or (columns[0] if len(columns) >= 1 else None)
    y_key = chart_config.get("yKey") or (columns[1] if len(columns) >= 2 else None)

    if not x_key or not y_key:
        return None

    categories = [str(r.get(x_key, "")) for r in rows]
    values = []
    for r in rows:
        v = r.get(y_key, 0)
        try:
            values.append(float(v) if v is not None else 0)
        except (ValueError, TypeError):
            values.append(0)

    return {
        "chartType": chart_type if chart_type in ("bar", "horizontal_bar", "line", "pie") else "bar",
        "title": title,
        "categories": categories,
        "series": [{"name": y_key, "values": values}],
    }


def _cache_key(source_id: str, template_id: str, filters: dict | None) -> str:
    """Build a deterministic cache key."""
    payload = json.dumps({"s": source_id, "t": template_id, "f": filters or {}}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _sanitize_value(v: Any) -> Any:
    """Ensure value is JSON serializable."""
    if v is None:
        return None
    if isinstance(v, (int, float, str, bool)):
        return v
    if isinstance(v, datetime):
        return v.isoformat()
    try:
        float(v)
        return float(v)
    except (ValueError, TypeError):
        return str(v)


async def execute_template(
    template: dict,
    source: Any,
    db: AsyncSession,
    user_id: str,
    organization_id: str | None = None,
    filters: dict | None = None,
    date_range: dict | None = None,
    disabled_queries: list[str] | None = None,
) -> dict[str, Any]:
    """
    Execute all queries in a template against the source and return results.

    Returns a dict matching TemplateRunResponse shape.
    """
    template_id = template["id"]
    template_name = template.get("name", "")
    refresh_interval = template.get("refresh_interval", 3600)

    # Check cache
    ck = _cache_key(source.id, template_id, filters)
    cached = _result_cache.get(ck)
    if cached and cached[1] > time.time():
        return cached[0]

    source_meta = source.metadata_ or {}
    connection_string = source_meta.get("connectionString") or source_meta.get("connection_string", "")
    table_infos = source_meta.get("table_infos") or []

    # Merge filters with date_range
    merged_filters = dict(filters or {})
    if date_range:
        if date_range.get("start"):
            merged_filters["date_start"] = date_range["start"]
        if date_range.get("end"):
            merged_filters["date_end"] = date_range["end"]

    # Get table names for {{table}} expansion
    table_names = []
    for ti in table_infos:
        if isinstance(ti, dict):
            table_names.append(ti.get("name", ti.get("table_name", "")))
        elif isinstance(ti, str):
            table_names.append(ti)

    queries = template.get("queries", [])
    disabled = set(disabled_queries or [])
    results = []
    start_time = time.time()

    loop = asyncio.get_event_loop()

    for query_def in queries:
        qid = query_def.get("id", "")
        qtitle = query_def.get("title", "")

        if qid in disabled:
            continue

        raw_sql = query_def.get("sql", "")

        # If SQL contains {{table}}, expand for each table and union results
        if "{{table}}" in raw_sql and table_names:
            all_rows: list[dict] = []
            last_error = None
            for tname in table_names:
                try:
                    resolved = _resolve_sql_placeholders(raw_sql, {**source_meta, "table": tname}, merged_filters)
                    rows = await loop.run_in_executor(None, _run_query_sync, connection_string, resolved)
                    all_rows.extend(rows)
                except Exception as exc:
                    last_error = str(exc)
                    logger.warning("Query %s failed for table %s: %s", qid, tname, exc)

            if all_rows:
                safe_rows = [{k: _sanitize_value(v) for k, v in r.items()} for r in all_rows]
                chart_spec = _build_chart_spec(safe_rows, query_def)
                results.append({
                    "queryId": qid,
                    "title": qtitle,
                    "rows": safe_rows,
                    "chartSpec": chart_spec,
                    "error": None,
                })
            elif last_error:
                results.append({
                    "queryId": qid,
                    "title": qtitle,
                    "rows": [],
                    "chartSpec": None,
                    "error": last_error,
                })
        else:
            try:
                resolved = _resolve_sql_placeholders(raw_sql, source_meta, merged_filters)
                rows = await loop.run_in_executor(None, _run_query_sync, connection_string, resolved)
                safe_rows = [{k: _sanitize_value(v) for k, v in r.items()} for r in rows]
                chart_spec = _build_chart_spec(safe_rows, query_def)
                results.append({
                    "queryId": qid,
                    "title": qtitle,
                    "rows": safe_rows,
                    "chartSpec": chart_spec,
                    "error": None,
                })
            except Exception as exc:
                logger.warning("Query %s failed: %s", qid, exc)
                results.append({
                    "queryId": qid,
                    "title": qtitle,
                    "rows": [],
                    "chartSpec": None,
                    "error": str(exc),
                })

    duration_ms = int((time.time() - start_time) * 1000)

    # Determine overall status
    errors = [r for r in results if r.get("error")]
    if not results:
        status = "error"
    elif len(errors) == len(results):
        status = "error"
    elif errors:
        status = "partial"
    else:
        status = "success"

    # Record execution in DB
    run_id = str(uuid.uuid4())
    run = ReportTemplateRun(
        id=run_id,
        user_id=user_id,
        organization_id=organization_id,
        source_id=source.id,
        template_id=template_id,
        status=status,
        results=results,
        duration_ms=duration_ms,
    )
    db.add(run)

    response = {
        "runId": run_id,
        "templateId": template_id,
        "templateName": template_name,
        "status": status,
        "results": results,
        "durationMs": duration_ms,
        "createdAt": datetime.utcnow().isoformat(),
    }

    # Cache result
    if status in ("success", "partial"):
        _result_cache[ck] = (response, time.time() + refresh_interval)

    return response
