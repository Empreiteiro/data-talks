"""
HubSpot CRM Q&A: fetch CRM objects via HubSpot API v3, normalize into tabular data,
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

HUBSPOT_API_BASE = "https://api.hubapi.com"
MAX_ROWS = 50_000

REPORT_TEMPLATES = [
    {
        "id": "sales-pipeline",
        "name": "Sales Pipeline",
        "description": "Analyze your sales pipeline: deal stages, values, and conversion rates.",
        "questions": [
            "What is the total value of deals in each pipeline stage?",
            "How many deals were created in the last 30 days?",
            "What is the average deal amount by stage?",
            "Which deals have been in the same stage the longest?",
            "What is the win rate by deal owner?",
        ],
    },
    {
        "id": "sales-performance",
        "name": "Sales Performance",
        "description": "Track sales team performance: closed deals, revenue, and activity.",
        "questions": [
            "What is the total revenue from closed-won deals this quarter?",
            "Who are the top 5 deal owners by total closed deal value?",
            "What is the average time to close a deal?",
            "How many deals were lost and what is the total lost value?",
            "What is the month-over-month trend of closed deals?",
        ],
    },
    {
        "id": "contact-lead-analysis",
        "name": "Contact & Lead Analysis",
        "description": "Understand your contacts and leads: sources, lifecycle stages, and engagement.",
        "questions": [
            "How many contacts are in each lifecycle stage?",
            "What are the top lead sources by contact count?",
            "How many new contacts were added each month?",
            "Which companies have the most associated contacts?",
            "What is the distribution of contacts by country or city?",
        ],
    },
    {
        "id": "company-analysis",
        "name": "Company Analysis",
        "description": "Analyze company data: industry distribution, size, and deal associations.",
        "questions": [
            "How many companies are in each industry?",
            "What is the total deal value per company?",
            "Which companies have the most open deals?",
            "What is the distribution of companies by number of employees?",
            "How many companies were created each month?",
        ],
    },
    {
        "id": "support-tickets",
        "name": "Support Tickets",
        "description": "Analyze support ticket data: status, priority, and resolution times.",
        "questions": [
            "How many tickets are in each status?",
            "What is the average time to close a ticket?",
            "Which ticket categories have the most volume?",
            "How many tickets were created each week this month?",
            "What is the ticket distribution by priority level?",
        ],
    },
]

# HubSpot object properties to fetch for each table
_OBJECT_PROPERTIES = {
    "contacts": [
        "firstname", "lastname", "email", "phone", "company", "jobtitle",
        "lifecyclestage", "hs_lead_status", "city", "state", "country",
        "createdate", "lastmodifieddate", "hs_object_id",
    ],
    "companies": [
        "name", "domain", "industry", "numberofemployees", "annualrevenue",
        "city", "state", "country", "phone", "website",
        "createdate", "lastmodifieddate", "hs_object_id",
    ],
    "deals": [
        "dealname", "amount", "dealstage", "pipeline", "closedate",
        "createdate", "hs_lastmodifieddate", "hubspot_owner_id",
        "hs_deal_stage_probability", "hs_object_id",
    ],
    "tickets": [
        "subject", "content", "hs_pipeline", "hs_pipeline_stage",
        "hs_ticket_priority", "hs_ticket_category", "createdate",
        "hs_lastmodifieddate", "closed_date", "hs_object_id",
    ],
    "line_items": [
        "name", "quantity", "price", "amount", "hs_product_id",
        "createdate", "hs_lastmodifieddate", "hs_object_id",
    ],
    "products": [
        "name", "description", "price", "hs_sku", "hs_cost_of_goods_sold",
        "createdate", "hs_lastmodifieddate", "hs_object_id",
    ],
}


def _hubspot_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _fetch_objects_sync(
    api_key: str,
    object_type: str,
    properties: list[str] | None = None,
    max_records: int = MAX_ROWS,
) -> list[dict]:
    """Fetch CRM objects with cursor pagination."""
    headers = _hubspot_headers(api_key)
    url = f"{HUBSPOT_API_BASE}/crm/v3/objects/{object_type}"
    all_records: list[dict] = []
    after = None

    with httpx.Client(timeout=30) as client:
        while len(all_records) < max_records:
            params: dict[str, Any] = {"limit": 100}
            if properties:
                params["properties"] = ",".join(properties)
            if after:
                params["after"] = after

            r = client.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()

            results = data.get("results", [])
            for item in results:
                record = {"id": item.get("id")}
                props = item.get("properties", {})
                record.update(props)
                all_records.append(record)

            paging = data.get("paging", {})
            next_link = paging.get("next", {})
            after = next_link.get("after")
            if not after or not results:
                break

    return all_records[:max_records]


def _fetch_owners_sync(api_key: str) -> list[dict]:
    """Fetch HubSpot owners."""
    headers = _hubspot_headers(api_key)
    url = f"{HUBSPOT_API_BASE}/crm/v3/owners"
    all_owners: list[dict] = []
    after = None

    with httpx.Client(timeout=30) as client:
        while True:
            params: dict[str, Any] = {"limit": 100}
            if after:
                params["after"] = after

            r = client.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()

            results = data.get("results", [])
            for item in results:
                all_owners.append({
                    "id": str(item.get("id", "")),
                    "email": item.get("email", ""),
                    "firstName": item.get("firstName", ""),
                    "lastName": item.get("lastName", ""),
                    "userId": str(item.get("userId", "")),
                })

            paging = data.get("paging", {})
            after = paging.get("next", {}).get("after")
            if not after or not results:
                break

    return all_owners


def _fetch_associations_sync(
    api_key: str,
    from_type: str,
    to_type: str,
    object_ids: list[str],
) -> list[dict]:
    """Fetch associations between object types."""
    if not object_ids:
        return []

    headers = _hubspot_headers(api_key)
    url = f"{HUBSPOT_API_BASE}/crm/v4/associations/{from_type}/{to_type}/batch/read"
    all_assocs: list[dict] = []

    # Process in batches of 100
    for i in range(0, len(object_ids), 100):
        batch_ids = object_ids[i:i + 100]
        body = {"inputs": [{"id": oid} for oid in batch_ids]}

        with httpx.Client(timeout=30) as client:
            r = client.post(url, headers=headers, json=body)
            if r.status_code == 200:
                data = r.json()
                for result in data.get("results", []):
                    from_id = result.get("from", {}).get("id", "")
                    for to_item in result.get("to", []):
                        all_assocs.append({
                            f"{from_type}_id": from_id,
                            f"{to_type}_id": to_item.get("toObjectId", ""),
                        })

    return all_assocs


def _test_connection_sync(api_key: str) -> dict:
    """Test HubSpot connection by fetching one contact."""
    headers = _hubspot_headers(api_key)
    with httpx.Client(timeout=15) as client:
        r = client.get(
            f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts",
            headers=headers,
            params={"limit": 1},
        )
        r.raise_for_status()
        return {"ok": True}


def _discover_objects_sync(api_key: str) -> dict:
    """Discover available object counts."""
    headers = _hubspot_headers(api_key)
    counts = {}
    object_types = ["contacts", "companies", "deals", "tickets", "line_items", "products"]

    with httpx.Client(timeout=15) as client:
        for obj_type in object_types:
            try:
                r = client.get(
                    f"{HUBSPOT_API_BASE}/crm/v3/objects/{obj_type}",
                    headers=headers,
                    params={"limit": 1},
                )
                if r.status_code == 200:
                    data = r.json()
                    total = data.get("total", len(data.get("results", [])))
                    counts[obj_type] = total
            except Exception:
                counts[obj_type] = 0

    return {"objectCounts": counts}


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


def _load_all_tables_sync(api_key: str) -> dict[str, pd.DataFrame]:
    """Fetch all HubSpot tables and return as DataFrames."""
    tables: dict[str, pd.DataFrame] = {}

    # Core objects
    for obj_type, props in _OBJECT_PROPERTIES.items():
        try:
            records = _fetch_objects_sync(api_key, obj_type, props)
            if records:
                tables[obj_type] = pd.json_normalize(records)
            else:
                tables[obj_type] = pd.DataFrame(columns=["id"] + props)
        except Exception:
            tables[obj_type] = pd.DataFrame(columns=["id"] + props)

    # Owners
    try:
        owners = _fetch_owners_sync(api_key)
        tables["owners"] = pd.DataFrame(owners) if owners else pd.DataFrame(columns=["id", "email", "firstName", "lastName", "userId"])
    except Exception:
        tables["owners"] = pd.DataFrame(columns=["id", "email", "firstName", "lastName", "userId"])

    # Associations
    deal_ids = tables["deals"]["id"].tolist() if "id" in tables.get("deals", pd.DataFrame()).columns else []
    if deal_ids:
        try:
            assocs = _fetch_associations_sync(api_key, "deals", "contacts", deal_ids[:1000])
            tables["deal_contacts"] = pd.DataFrame(assocs) if assocs else pd.DataFrame(columns=["deals_id", "contacts_id"])
        except Exception:
            tables["deal_contacts"] = pd.DataFrame(columns=["deals_id", "contacts_id"])

        try:
            assocs = _fetch_associations_sync(api_key, "deals", "companies", deal_ids[:1000])
            tables["deal_companies"] = pd.DataFrame(assocs) if assocs else pd.DataFrame(columns=["deals_id", "companies_id"])
        except Exception:
            tables["deal_companies"] = pd.DataFrame(columns=["deals_id", "companies_id"])

        try:
            assocs = _fetch_associations_sync(api_key, "deals", "line_items", deal_ids[:1000])
            tables["deal_line_items"] = pd.DataFrame(assocs) if assocs else pd.DataFrame(columns=["deals_id", "line_items_id"])
        except Exception:
            tables["deal_line_items"] = pd.DataFrame(columns=["deals_id", "line_items_id"])
    else:
        tables["deal_contacts"] = pd.DataFrame(columns=["deals_id", "contacts_id"])
        tables["deal_companies"] = pd.DataFrame(columns=["deals_id", "companies_id"])
        tables["deal_line_items"] = pd.DataFrame(columns=["deals_id", "line_items_id"])

    return tables


async def ask_hubspot(
    api_key: str,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for HubSpot CRM Q&A."""
    loop = asyncio.get_event_loop()

    tables = await loop.run_in_executor(None, lambda: _load_all_tables_sync(api_key))

    # Load into in-memory SQLite
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

    # Build profile from deals table (most important for analysis)
    main_df = tables.get("deals", pd.DataFrame())
    if main_df.empty:
        main_df = tables.get("contacts", pd.DataFrame())
    sample_profile = _build_sample_profile(main_df.head(1000))

    profile_lines = []
    for col, info in sample_profile.get("columns", {}).items():
        line = f"- {col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
        profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    # Build sample data
    preview_parts = []
    for tname, tdf in tables.items():
        if not tdf.empty:
            preview_parts.append(f"--- {tname} (sample) ---\n{json.dumps(tdf.head(3).to_dict(orient='records'), default=str, ensure_ascii=False)}")

    system = (
        "You are an assistant that answers questions about HubSpot CRM data. "
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
        f"HubSpot CRM Data Schema:\n{schema_text}\n\n"
        f"Sample profile (deals/contacts):\n{profile_text}\n\n"
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
    trace["source_type"] = "hubspot"
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
