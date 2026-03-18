"""
Google Analytics 4 (GA4) Q&A: fetch analytics data via GA4 Data API,
convert to DataFrames stored in a temp SQLite DB, then use LLM + SQL
to answer natural-language questions.
"""
from typing import Any
import asyncio
import json
import re
import time
import sqlite3
import tempfile
from datetime import datetime, timedelta

import httpx


# ---------------------------------------------------------------------------
# GA4 table definitions: each "table" is a runReport call with specific
# dimension/metric combos.
# ---------------------------------------------------------------------------

GA4_TABLES: dict[str, dict[str, Any]] = {
    "page_views": {
        "dimensions": ["pagePath", "pageTitle", "date"],
        "metrics": ["screenPageViews", "totalUsers", "sessions", "averageSessionDuration", "bounceRate"],
    },
    "traffic_sources": {
        "dimensions": ["sessionSource", "sessionMedium", "sessionCampaignName", "date"],
        "metrics": ["sessions", "totalUsers", "newUsers", "bounceRate"],
    },
    "events": {
        "dimensions": ["eventName", "date"],
        "metrics": ["eventCount", "totalUsers"],
    },
    "user_demographics": {
        "dimensions": ["country", "city", "language"],
        "metrics": ["totalUsers", "sessions", "newUsers"],
    },
    "device_data": {
        "dimensions": ["deviceCategory", "operatingSystem", "browser"],
        "metrics": ["totalUsers", "sessions", "screenPageViews"],
    },
    "conversions": {
        "dimensions": ["eventName", "date"],
        "metrics": ["conversions", "totalRevenue"],
    },
    "ecommerce": {
        "dimensions": ["itemName", "itemCategory", "date"],
        "metrics": ["itemRevenue", "itemsPurchased", "itemsViewed"],
    },
}

# ---------------------------------------------------------------------------
# Report templates
# ---------------------------------------------------------------------------

REPORT_TEMPLATES: list[dict[str, str]] = [
    {
        "name": "Traffic Overview",
        "question": "Show me a traffic overview with total sessions, users, page views, average session duration, and bounce rate for the last 30 days.",
    },
    {
        "name": "Acquisition",
        "question": "What are the top traffic sources by sessions and users? Break down by source/medium.",
    },
    {
        "name": "User Behavior",
        "question": "What are the top pages by page views and which events are triggered most frequently?",
    },
    {
        "name": "Audience Demographics",
        "question": "Show me the geographic and language breakdown of users including top countries and cities.",
    },
    {
        "name": "E-commerce Performance",
        "question": "Show ecommerce revenue by product, including items purchased, items viewed, and total item revenue.",
    },
]


# ---------------------------------------------------------------------------
# Auth helpers: create a JWT from service account JSON, exchange for an
# access token. This avoids requiring google-auth or google-analytics-data
# libraries.
# ---------------------------------------------------------------------------

def _build_jwt(service_account: dict) -> str:
    """Build a signed JWT for Google OAuth2 using the service account private key."""
    import jwt as pyjwt  # PyJWT

    now = int(time.time())
    payload = {
        "iss": service_account["client_email"],
        "scope": "https://www.googleapis.com/auth/analytics.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }
    return pyjwt.encode(payload, service_account["private_key"], algorithm="RS256")


async def _get_access_token(service_account: dict) -> str:
    """Exchange a self-signed JWT for a Google OAuth2 access token."""
    signed_jwt = _build_jwt(service_account)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": signed_jwt,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# GA4 Data API helpers
# ---------------------------------------------------------------------------

async def _run_report(
    access_token: str,
    property_id: str,
    dimensions: list[str],
    metrics: list[str],
    start_date: str = "30daysAgo",
    end_date: str = "today",
    limit: int = 10000,
) -> list[dict]:
    """
    Call the GA4 Data API runReport endpoint and return rows as list of dicts.
    """
    url = f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport"
    body = {
        "dateRanges": [{"startDate": start_date, "endDate": end_date}],
        "dimensions": [{"name": d} for d in dimensions],
        "metrics": [{"name": m} for m in metrics],
        "limit": limit,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            json=body,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    rows: list[dict] = []
    dim_headers = [h["name"] for h in data.get("dimensionHeaders", [])]
    met_headers = [h["name"] for h in data.get("metricHeaders", [])]

    for row in data.get("rows", []):
        record: dict[str, Any] = {}
        for i, dv in enumerate(row.get("dimensionValues", [])):
            record[dim_headers[i]] = dv.get("value", "")
        for i, mv in enumerate(row.get("metricValues", [])):
            val = mv.get("value", "0")
            # Try to parse as number
            try:
                record[met_headers[i]] = float(val) if "." in val else int(val)
            except (ValueError, TypeError):
                record[met_headers[i]] = val
        rows.append(record)

    return rows


async def _fetch_all_tables(
    access_token: str,
    property_id: str,
    tables: list[str] | None = None,
    start_date: str = "30daysAgo",
    end_date: str = "today",
) -> dict[str, list[dict]]:
    """Fetch data for all (or selected) GA4 tables concurrently."""
    target_tables = tables or list(GA4_TABLES.keys())
    results: dict[str, list[dict]] = {}

    async def _fetch_one(table_name: str):
        defn = GA4_TABLES[table_name]
        try:
            rows = await _run_report(
                access_token=access_token,
                property_id=property_id,
                dimensions=defn["dimensions"],
                metrics=defn["metrics"],
                start_date=start_date,
                end_date=end_date,
            )
            results[table_name] = rows
        except Exception:
            results[table_name] = []

    await asyncio.gather(*[_fetch_one(t) for t in target_tables if t in GA4_TABLES])
    return results


def _test_connection_sync(access_token: str, property_id: str) -> dict:
    """Run a minimal report to verify credentials and property ID. Sync wrapper."""
    import httpx as _httpx

    url = f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport"
    body = {
        "dateRanges": [{"startDate": "7daysAgo", "endDate": "today"}],
        "dimensions": [{"name": "date"}],
        "metrics": [{"name": "totalUsers"}],
        "limit": 1,
    }
    resp = _httpx.post(
        url,
        json=body,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    row_count = len(data.get("rows", []))
    return {"ok": True, "rowCount": row_count}


# ---------------------------------------------------------------------------
# SQLite helper: load fetched rows into a temp SQLite database
# ---------------------------------------------------------------------------

def _load_into_sqlite(table_data: dict[str, list[dict]]) -> str:
    """Create a temp SQLite DB and load all table data. Returns the DB path."""
    import pandas as pd

    db_path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(db_path)
    for table_name, rows in table_data.items():
        if not rows:
            continue
        df = pd.DataFrame(rows)
        df.to_sql(table_name, conn, if_exists="replace", index=False)
    conn.close()
    return db_path


def _get_schema_text(table_data: dict[str, list[dict]]) -> str:
    """Build a text description of all tables and columns for the LLM."""
    parts: list[str] = []
    for table_name, rows in table_data.items():
        if not rows:
            parts.append(f"Table '{table_name}': (no data)")
            continue
        columns = list(rows[0].keys())
        sample = rows[:3]
        parts.append(f"Table '{table_name}': columns {columns}")
        parts.append(f"  Sample rows: {json.dumps(sample, ensure_ascii=False, default=str)[:500]}")
    return "\n".join(parts)


def _run_sql(db_path: str, sql: str) -> list[dict]:
    """Execute SQL on the temp SQLite DB and return results as list of dicts."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(sql)
        rows = [dict(r) for r in cursor.fetchall()]
        return rows
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Discover: build table_infos metadata for storage
# ---------------------------------------------------------------------------

async def discover_ga4(
    credentials_content: str,
    property_id: str,
    tables: list[str] | None = None,
) -> list[dict]:
    """
    Fetch sample data from each GA4 table and return table_infos
    suitable for storing in source metadata.
    """
    sa = json.loads(credentials_content)
    access_token = await _get_access_token(sa)
    table_data = await _fetch_all_tables(access_token, property_id, tables)

    table_infos: list[dict] = []
    for table_name, rows in table_data.items():
        columns = list(rows[0].keys()) if rows else []
        preview = rows[:5] if rows else []
        table_infos.append({
            "table": table_name,
            "columns": columns,
            "preview_rows": [{k: str(v) for k, v in r.items()} for r in preview],
            "row_count": len(rows),
        })
    return table_infos


# ---------------------------------------------------------------------------
# Main entry point: ask_ga4
# ---------------------------------------------------------------------------

async def ask_ga4(
    credentials_content: str,
    property_id: str,
    tables: list[str] | None,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Main entry point for GA4 Q&A.

    credentials_content: Service account JSON string.
    property_id: GA4 property ID (e.g. "123456789").
    tables: list of GA4 table names to include, or None for all 7.
    """
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not credentials_content:
        raise ValueError("GA4 credentials_content is required")
    if not property_id:
        raise ValueError("GA4 property_id is required")

    sa = json.loads(credentials_content)
    access_token = await _get_access_token(sa)

    # Fetch data from GA4
    target_tables = tables or list(GA4_TABLES.keys())
    table_data = await _fetch_all_tables(access_token, property_id, target_tables)

    # Load into temp SQLite
    db_path = _load_into_sqlite(table_data)

    # Build schema text
    schema_text = f"GA4 Property: {property_id}\n"
    if table_infos:
        for ti in table_infos:
            schema_text += f"\nTable '{ti['table']}': columns {ti.get('columns', [])}"
            preview = ti.get("preview_rows", [])
            if preview:
                schema_text += f"\n  Sample: {json.dumps(preview[:3], ensure_ascii=False, default=str)[:400]}"
    else:
        schema_text += _get_schema_text(table_data)

    # Build LLM prompt
    system = (
        "You are a data analyst assistant. The user has a Google Analytics 4 (GA4) property. "
        "The data has been loaded into a SQLite database with the following tables: "
        f"{', '.join(target_tables)}. "
        "Answer the question by writing a SQL query that runs against the SQLite database. "
        "Return ONLY valid JSON with keys: "
        "\"answer\" (string - a brief natural language answer), "
        "\"followUpQuestions\" (array of up to 3 strings), "
        "\"sql\" (string - a SQLite-compatible SQL query to compute the answer, or null if not needed). "
        "Any suggested follow-up questions must be answerable using only the available tables and columns. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "ga4"
    await record_log(
        action="pergunta",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )

    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_code = (parsed.get("sql") or "").strip()

    chart_input = None
    if sql_code:
        try:
            rows = _run_sql(db_path, sql_code)
            if rows:
                chart_input = build_chart_input(rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=rows,
                    agent_description=agent_description,
                    source_name=source_name,
                    schema_text=schema_text,
                    llm_overrides=llm_overrides,
                    channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Error executing SQL on GA4 data: {e}*"

    # Clean up temp DB
    try:
        import os
        os.unlink(db_path)
    except Exception:
        pass

    if not parsed["parsed_ok"]:
        if not answer:
            answer = raw_answer
        if not follow_up:
            follow_up = _extract_followups(raw_answer)

    follow_up = await refine_followup_questions(
        question=question,
        candidate_questions=follow_up,
        schema_text=schema_text,
        llm_overrides=llm_overrides,
        channel=channel,
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data: Any, parsed_ok: bool) -> dict[str, Any]:
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_code = data.get("sql") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_code, str):
            sql_code = ""
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "sql": sql_code,
            "parsed_ok": parsed_ok,
        }

    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        return _coerce(json.loads(raw_clean), True)
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return _coerce(json.loads(raw_clean[start: end + 1]), True)
            except json.JSONDecodeError:
                pass
        return _coerce({}, False)


def _extract_followups(raw: str) -> list[str]:
    follow_up = []
    for line in raw.split("\n"):
        cleaned = line.strip().lstrip("-0123456789. ").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
