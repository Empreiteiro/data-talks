"""
Studio Summary for SQL database: executive report from schema + analytical queries (capped).
Runs 3-5 SELECT queries with row limit; never passes the full table.
"""
from typing import Any
import asyncio
import json
import re

MAX_ROWS_PER_QUERY = 15


def _schema_text(table_infos: list[dict]) -> str:
    lines = []
    for t in table_infos:
        lines.append(f"Table {t.get('table', '')}: columns {t.get('columns', [])}")
    return "\n".join(lines) if lines else "No schema"


def _ensure_limit(query: str, limit: int = MAX_ROWS_PER_QUERY) -> str:
    q = query.strip().rstrip(";")
    if not q.upper().startswith("SELECT"):
        return ""
    # Already has LIMIT / FETCH?
    upper = q.upper()
    if "LIMIT" in upper or "FETCH" in upper:
        return q
    return f"{q} LIMIT {limit}"


def _run_query_sync(connection_string: str, query: str) -> list[dict]:
    from sqlalchemy import create_engine, text

    engine = create_engine(connection_string)
    safe_query = _ensure_limit(query)
    if not safe_query:
        raise ValueError("Only SELECT queries with limit are allowed")
    with engine.connect() as conn:
        result = conn.execute(text(safe_query))
        rows = result.mappings().fetchall()
    return [dict(r) for r in rows]


def _sanitize_row(row: dict) -> dict:
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


async def generate_table_summary_sql(
    connection_string: str,
    table_infos: list[dict] | None,
    source_name: str = "",
    llm_overrides: dict | None = None,
) -> dict[str, Any]:
    """
    Returns: { "report": str (markdown), "queries_run": [ { "query": str, "rows": list }, ... ] }
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log

    if not table_infos:
        raise ValueError("SQL source requires table_infos (schema)")

    schema_text = _schema_text(table_infos)
    table_names = [t.get("table", "") for t in table_infos]

    # Step 1: LLM suggests 3-5 analytical SELECT queries (we will add LIMIT)
    system_queries = (
        "You are a data analyst. Given the database table schema below, suggest 3 to 5 analytical SELECT queries "
        "that help understand the data: e.g. row count, distinct values, min/max of numeric columns, "
        "sample rows, simple aggregations. Use only the table and column names given. "
        "Return ONLY a JSON object with one key: \"queries\" (array of strings). Each string is a single SELECT query. "
        "Do not include LIMIT in the query; the system will add it. No markdown, no explanation."
    )
    user_queries = (
        f"Schema:\n{schema_text}\n\nTables: {table_names}\n\n"
        'Generate 3-5 analytical SELECT queries. Return JSON: {"queries": ["SELECT ...", ...]}'
    )
    raw_queries, usage1 = await chat_completion(
        [{"role": "system", "content": system_queries}, {"role": "user", "content": user_queries}],
        max_tokens=1024,
        llm_overrides=llm_overrides,
    )
    await record_log(
        action="summary",
        provider=usage1.get("provider", ""),
        model=usage1.get("model", ""),
        input_tokens=usage1.get("input_tokens", 0),
        output_tokens=usage1.get("output_tokens", 0),
        source=source_name or (table_names[0] if table_names else "SQL"),
    )
    queries = _parse_queries_json(raw_queries)

    loop = asyncio.get_event_loop()
    queries_run: list[dict] = []
    for q in queries:
        q = (q or "").strip()
        if not q.upper().startswith("SELECT"):
            continue
        try:
            rows = await loop.run_in_executor(
                None, lambda qq=q: _run_query_sync(connection_string, qq)
            )
            rows = rows[:MAX_ROWS_PER_QUERY]
            rows_serializable = [_sanitize_row(r) for r in rows]
            queries_run.append({"query": _ensure_limit(q), "rows": rows_serializable})
        except Exception as e:
            queries_run.append({"query": _ensure_limit(q), "rows": [], "error": str(e)})

    # Step 2: LLM writes executive summary from schema + query results
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
        "what this table/database contains based on the schema and the query results below. "
        "Keep it concise (1-2 pages when rendered). Include: what the data represents, key metrics or findings, "
        "and any notable patterns or caveats. Use clear headings and bullet points. "
        "Write in the same language as the data."
    )
    user_report = (
        f"Source name: {source_name or table_names[0] if table_names else 'SQL table'}\n\n"
        f"Schema:\n{schema_text}\n\n"
        f"Query results:\n{results_text}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage2 = await chat_completion(
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
        source=source_name or (table_names[0] if table_names else "SQL"),
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
