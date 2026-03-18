"""
Pipedrive CRM Q&A: fetch CRM data via Pipedrive API v1, normalize into tabular data,
then use LLM + SQL-on-SQLite to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import math
import re
import sqlite3

import httpx
import pandas as pd

from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field

PIPEDRIVE_API_BASE = "https://api.pipedrive.com/v1"
MAX_ROWS = 50_000

REPORT_TEMPLATES = [
    {
        "id": "sales-pipeline",
        "name": "Sales Pipeline",
        "description": "Analyze your sales pipeline: deal stages, values, and conversion rates.",
        "questions": [
            "What is the total value of deals in each pipeline stage?",
            "How many open deals are in each stage?",
            "What is the average deal value by stage?",
            "Which deals have been in the same stage the longest?",
            "What is the conversion rate between pipeline stages?",
        ],
    },
    {
        "id": "sales-performance",
        "name": "Sales Performance",
        "description": "Track sales performance: closed deals, revenue, and win rates.",
        "questions": [
            "What is the total revenue from won deals this month?",
            "Who are the top 5 sales reps by total won deal value?",
            "What is the average time to close a deal?",
            "How many deals were lost and what is the total lost value?",
            "What is the win rate by pipeline?",
        ],
    },
    {
        "id": "activity-tracking",
        "name": "Activity Tracking",
        "description": "Monitor sales activities: calls, emails, meetings, and tasks.",
        "questions": [
            "How many activities were completed this week by type?",
            "Who has the most overdue activities?",
            "What is the average number of activities per deal before closing?",
            "Which activity types are most common for won deals?",
            "How many activities were scheduled vs completed this month?",
        ],
    },
    {
        "id": "lead-contact-analysis",
        "name": "Lead & Contact Analysis",
        "description": "Understand your contacts and leads: sources, organizations, and engagement.",
        "questions": [
            "How many persons are associated with each organization?",
            "What is the distribution of leads by source?",
            "How many new contacts were added each month?",
            "Which organizations have the most deals?",
            "How many leads were converted to deals?",
        ],
    },
    {
        "id": "product-performance",
        "name": "Product Performance",
        "description": "Analyze product sales: quantities, revenue, and deal associations.",
        "questions": [
            "Which products generate the most revenue?",
            "What is the average quantity sold per product?",
            "How many deals include each product?",
            "What is the average discount applied per product?",
            "Which product combinations are most common in deals?",
        ],
    },
    {
        "id": "forecast",
        "name": "Forecast",
        "description": "Sales forecasting based on pipeline data and historical trends.",
        "questions": [
            "What is the total weighted pipeline value?",
            "What is the expected revenue for next month based on deal close dates?",
            "How does current pipeline compare to last quarter?",
            "What is the average deal cycle length by pipeline?",
            "Which deals are expected to close this month?",
        ],
    },
]

_PIPEDRIVE_RESOURCES = {
    "persons": "persons",
    "organizations": "organizations",
    "deals": "deals",
    "activities": "activities",
    "products": "products",
    "pipelines": "pipelines",
    "stages": "stages",
    "leads": "leads",
    "notes": "notes",
}


def _fetch_resource_sync(
    api_token: str,
    resource: str,
    max_records: int = MAX_ROWS,
) -> list[dict]:
    """Fetch Pipedrive resource with cursor pagination."""
    url = f"{PIPEDRIVE_API_BASE}/{resource}"
    all_records: list[dict] = []
    start = 0
    limit = 100

    with httpx.Client(timeout=30) as client:
        while len(all_records) < max_records:
            params = {"api_token": api_token, "start": start, "limit": limit}
            r = client.get(url, params=params)
            r.raise_for_status()
            data = r.json()

            if not data.get("success"):
                break

            items = data.get("data") or []
            if not items:
                break

            all_records.extend(items if isinstance(items, list) else [items])

            additional = data.get("additional_data", {})
            pagination = additional.get("pagination", {})
            if not pagination.get("more_items_in_collection"):
                break

            start = pagination.get("next_start", start + limit)

    return all_records[:max_records]


def _fetch_deal_products_sync(api_token: str, deal_ids: list[int]) -> list[dict]:
    """Fetch products attached to deals."""
    all_records: list[dict] = []
    with httpx.Client(timeout=30) as client:
        for did in deal_ids[:500]:
            try:
                r = client.get(
                    f"{PIPEDRIVE_API_BASE}/deals/{did}/products",
                    params={"api_token": api_token},
                )
                if r.status_code == 200:
                    data = r.json()
                    items = data.get("data") or []
                    for item in items:
                        item["deal_id"] = did
                        all_records.append(item)
            except Exception:
                continue
    return all_records


def _test_connection_sync(api_token: str) -> dict:
    """Test Pipedrive connection."""
    with httpx.Client(timeout=15) as client:
        r = client.get(
            f"{PIPEDRIVE_API_BASE}/users/me",
            params={"api_token": api_token},
        )
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise ValueError("Invalid API token")
        return {"ok": True, "userName": data.get("data", {}).get("name", "")}


def _discover_resources_sync(api_token: str) -> dict:
    """Discover available resource counts."""
    counts = {}
    with httpx.Client(timeout=15) as client:
        for name, resource in _PIPEDRIVE_RESOURCES.items():
            try:
                r = client.get(
                    f"{PIPEDRIVE_API_BASE}/{resource}",
                    params={"api_token": api_token, "start": 0, "limit": 1},
                )
                if r.status_code == 200:
                    data = r.json()
                    additional = data.get("additional_data", {})
                    pagination = additional.get("pagination", {})
                    counts[name] = pagination.get("count", len(data.get("data") or []))
                else:
                    counts[name] = 0
            except Exception:
                counts[name] = 0
    return {"resourceCounts": counts}


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _build_sample_profile(df: pd.DataFrame) -> dict:
    sample_rows = len(df)
    profile: dict = {"sample_rows": sample_rows, "columns": {}}
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile: dict = {"type": str(series.dtype), "missing": int(series.isna().sum())}
        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                col_profile["numeric"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                }
        profile["columns"][str(col)] = col_profile
    return profile


def _load_all_tables_sync(api_token: str) -> dict[str, pd.DataFrame]:
    """Fetch all Pipedrive tables and return as DataFrames."""
    tables: dict[str, pd.DataFrame] = {}

    for name, resource in _PIPEDRIVE_RESOURCES.items():
        try:
            records = _fetch_resource_sync(api_token, resource)
            if records:
                tables[name] = pd.json_normalize(records, sep="_")
            else:
                tables[name] = pd.DataFrame()
        except Exception:
            tables[name] = pd.DataFrame()

    # Deal products (derived table)
    deal_ids = []
    if not tables.get("deals", pd.DataFrame()).empty and "id" in tables["deals"].columns:
        deal_ids = tables["deals"]["id"].tolist()
    if deal_ids:
        try:
            dp = _fetch_deal_products_sync(api_token, deal_ids)
            tables["deal_products"] = pd.json_normalize(dp, sep="_") if dp else pd.DataFrame()
        except Exception:
            tables["deal_products"] = pd.DataFrame()
    else:
        tables["deal_products"] = pd.DataFrame()

    # Derived timelines
    if not tables.get("deals", pd.DataFrame()).empty:
        deals_df = tables["deals"]
        timeline_cols = [c for c in ["id", "title", "value", "status", "add_time", "close_time", "won_time", "lost_time", "stage_id", "pipeline_id"] if c in deals_df.columns]
        if timeline_cols:
            tables["deal_timeline"] = deals_df[timeline_cols].copy()

    if not tables.get("activities", pd.DataFrame()).empty:
        act_df = tables["activities"]
        timeline_cols = [c for c in ["id", "type", "done", "due_date", "due_time", "add_time", "marked_as_done_time", "deal_id", "person_id", "org_id"] if c in act_df.columns]
        if timeline_cols:
            tables["activity_timeline"] = act_df[timeline_cols].copy()

    return tables


async def ask_pipedrive(
    api_token: str,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Pipedrive CRM Q&A."""
    loop = asyncio.get_event_loop()
    tables = await loop.run_in_executor(None, lambda: _load_all_tables_sync(api_token))

    conn = sqlite3.connect(":memory:")
    schema_parts = []
    for table_name, df in tables.items():
        if df.empty and len(df.columns) == 0:
            continue
        df.to_sql(table_name, conn, index=False, if_exists="replace")
        cols = ", ".join(df.columns)
        row_count = len(df)
        schema_parts.append(f"Table '{table_name}' ({row_count} rows): {cols}")

    schema_text = "\n".join(schema_parts)

    main_df = tables.get("deals", pd.DataFrame())
    if main_df.empty:
        main_df = tables.get("persons", pd.DataFrame())
    sample_profile = _build_sample_profile(main_df.head(1000))

    profile_lines = []
    for col, info in sample_profile.get("columns", {}).items():
        line = f"- {col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
        profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    preview_parts = []
    for tname, tdf in tables.items():
        if not tdf.empty:
            preview_parts.append(f"--- {tname} (sample) ---\n{json.dumps(tdf.head(3).to_dict(orient='records'), default=str, ensure_ascii=False)}")

    system = (
        "You are an assistant that answers questions about Pipedrive CRM data. "
        "The data is loaded into multiple SQLite tables. "
        f"Available tables and columns:\n{schema_text}\n\n"
        "For questions requiring filtering, counting, or aggregation, provide a SQL query in sqlQuery. "
        "Use standard SQL with JOINs across tables as needed. "
        "Quote column names with double quotes if they contain special characters. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"Pipedrive CRM Data Schema:\n{schema_text}\n\n"
        f"Sample profile (deals):\n{profile_text}\n\n"
        f"Sample data:\n{chr(10).join(preview_parts[:5])}\n\n"
        f"User question: {question}"
    )

    messages: list[dict] = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "pipedrive"
    await record_log(
        action="pergunta", provider=usage.get("provider", ""), model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0), output_tokens=usage.get("output_tokens", 0),
        source=source_name, channel=channel, trace=trace,
    )

    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_query = extract_sql_from_field(parsed.get("sqlQuery") or "")

    chart_input = None
    try:
        if sql_query and sql_query.upper().strip().startswith("SELECT"):
            try:
                cur = conn.execute(sql_query)
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, row)) for row in cur.fetchall()]
                if rows:
                    chart_input = build_chart_input(rows, schema_text)
                    elaborated = await elaborate_answer_with_results(
                        question=question, query_results=rows, agent_description=agent_description,
                        source_name=source_name, schema_text=schema_text,
                        llm_overrides=llm_overrides, channel=channel,
                    )
                    answer = elaborated["answer"]
                    follow_up = elaborated["followUpQuestions"] or follow_up
            except Exception as e:
                answer = f"{answer}\n\n*Error executing SQL: {e}*"
    finally:
        conn.close()

    if not parsed["parsed_ok"] and not answer:
        answer = raw_answer

    follow_up = await refine_followup_questions(
        question=question, candidate_questions=follow_up, schema_text=schema_text,
        llm_overrides=llm_overrides, channel=channel,
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data, parsed_ok):
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_query = data.get("sqlQuery") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_query, str):
            sql_query = ""
        return {"answer": answer, "followUpQuestions": follow_up[:3], "sqlQuery": sql_query, "parsed_ok": parsed_ok}

    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        return _coerce(json.loads(raw_clean), True)
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return _coerce(json.loads(raw_clean[start:end + 1]), True)
            except json.JSONDecodeError:
                pass
        return _coerce({}, False)
