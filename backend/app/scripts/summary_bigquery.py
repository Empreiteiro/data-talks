"""
Studio Summary: generate executive report for a BigQuery table.
1. Use table structure (table_infos) to ask LLM for 3-5 analytical queries.
2. Run each query and collect results (capped).
3. Use LLM to write a concise executive summary from schema + results.
"""
from typing import Any
import asyncio
import json
import re

from app.scripts.ask_bigquery import (
    _get_bigquery_client,
    _fetch_table_infos_sync,
    _run_query_sync,
)

MAX_ROWS_PER_QUERY = 15  # cap for report context


def _schema_text(project_id: str, dataset_id: str, table_infos: list[dict]) -> str:
    t = f"Project: {project_id}, Dataset: {dataset_id}, Tables: {[x.get('table') for x in table_infos]}"
    for x in table_infos:
        t += f"\nTable {x.get('table', '')}: columns {x.get('columns', [])}"
    return t


def _sanitize_row(row: dict) -> dict:
    """Make row JSON-serializable (dates, decimals, etc.)."""
    out = {}
    for k, v in row.items():
        if v is None:
            out[k] = None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            try:
                from decimal import Decimal
                if isinstance(v, Decimal):
                    out[k] = float(v) if getattr(v, "is_finite", lambda: True)() else None
                else:
                    out[k] = v
            except (ImportError, TypeError, ValueError):
                out[k] = str(v) if v is not None else None
    return out


async def generate_table_summary_bigquery(
    credentials_content: str | None,
    project_id: str,
    dataset_id: str,
    tables: list[str],
    table_infos: list[dict] | None = None,
    source_name: str = "",
    llm_overrides: dict | None = None,
) -> dict[str, Any]:
    """
    Returns: { "report": str (markdown), "queries_run": [ { "query": str, "rows": list }, ... ] }
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log

    loop = asyncio.get_event_loop()
    client = await loop.run_in_executor(None, lambda: _get_bigquery_client(credentials_content))

    if table_infos:
        table_infos = [
            {"table": t.get("table") or t.get("table_name", ""), "columns": t.get("columns") or []}
            for t in table_infos
        ]
    if not table_infos or not any(t.get("columns") for t in table_infos):
        table_infos = await loop.run_in_executor(
            None, lambda: _fetch_table_infos_sync(client, project_id, dataset_id, tables)
        )

    schema_text = _schema_text(project_id, dataset_id, table_infos)

    # Step 1: LLM suggests 3-5 analytical queries (SELECT only)
    system_queries = (
        "You are a data analyst. Given the BigQuery table schema below, suggest 3 to 5 analytical SELECT queries "
        "that help understand the table: e.g. total row count, distinct values of key columns, min/max of numeric columns, "
        "sample of recent or important rows, simple aggregations. "
        "Use full table names: `project_id.dataset_id.table_id`. "
        "Return ONLY a JSON object with one key: \"queries\" (array of strings). Each string is a single SELECT query. "
        "No markdown, no explanation outside the JSON."
    )
    msg_queries = (
        f"Schema:\n{schema_text}\n\nGenerate 3-5 analytical SELECT queries for this table. "
        'Return JSON with key "queries" (array of SELECT query strings).'
    )
    raw_queries, usage1, trace1 = await chat_completion(
        [{"role": "system", "content": system_queries}, {"role": "user", "content": msg_queries}],
        max_tokens=1024,
        llm_overrides=llm_overrides,
    )
    await record_log(
        action="summary",
        provider=usage1.get("provider", ""),
        model=usage1.get("model", ""),
        input_tokens=usage1.get("input_tokens", 0),
        output_tokens=usage1.get("output_tokens", 0),
        source=source_name or (table_infos[0].get("table") if table_infos else ""),
        trace=trace1,
    )
    queries = _parse_queries_json(raw_queries)

    # Step 2: Run each query and collect results (capped)
    queries_run: list[dict] = []
    for q in queries:
        q = (q or "").strip()
        if not q.upper().startswith("SELECT"):
            continue
        try:
            rows = await loop.run_in_executor(None, lambda qq=q: _run_query_sync(client, qq))
            rows = rows[:MAX_ROWS_PER_QUERY]
            rows_serializable = [_sanitize_row(r) for r in rows]
            queries_run.append({"query": q, "rows": rows_serializable})
        except Exception as e:
            queries_run.append({"query": q, "rows": [], "error": str(e)})

    # Step 3: LLM writes executive summary from schema + query results
    results_text = ""
    for i, item in enumerate(queries_run, 1):
        results_text += f"\n--- Query {i} ---\n{item.get('query', '')}\n"
        if item.get("error"):
            results_text += f"Error: {item['error']}\n"
        else:
            rows = item.get("rows") or []
            if not rows:
                results_text += "Result: 0 rows.\n"
            else:
                results_text += f"Result ({len(rows)} row(s)):\n{json.dumps(rows, ensure_ascii=False, default=str)}\n"

    system_report = (
        "You are a business analyst. Write a short executive summary (report) in Markdown that explains "
        "what this table contains and what the data shows, based on the schema and the query results below. "
        "Keep it concise (1-2 pages when rendered). Include: what the table represents, key metrics or findings from the queries, "
        "and any notable patterns or caveats. Use clear headings and bullet points. Write in the same language as the query results (e.g. Portuguese if data is in Portuguese)."
    )
    user_report = (
        f"Table name: {source_name or (table_infos[0].get('table') if table_infos else '')}\n\n"
        f"Schema:\n{schema_text}\n\n"
        f"Query results:\n{results_text}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage2, trace2 = await chat_completion(
        [{"role": "system", "content": system_report}, {"role": "user", "content": user_report}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    await record_log(
        action="summary",
        provider=usage2.get("provider", ""),
        model=usage2.get("model", ""),
        input_tokens=usage2.get("input_tokens", 0),
        output_tokens=usage2.get("output_tokens", 0),
        source=source_name or (table_infos[0].get("table") if table_infos else ""),
        trace=trace2,
    )
    report = (report or "").strip()

    return {"report": report, "queries_run": queries_run}


def _parse_queries_json(raw: str) -> list[str]:
    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        data = json.loads(raw_clean)
        qs = data.get("queries") if isinstance(data, dict) else None
        if isinstance(qs, list):
            return [str(x).strip() for x in qs if x]
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end > start:
            try:
                data = json.loads(raw_clean[start : end + 1])
                qs = data.get("queries") if isinstance(data, dict) else None
                if isinstance(qs, list):
                    return [str(x).strip() for x in qs if x]
            except json.JSONDecodeError:
                pass
    return []
