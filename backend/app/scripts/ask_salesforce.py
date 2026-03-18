"""
Salesforce CRM Q&A: fetch CRM objects via Salesforce SOQL REST API, normalize into tabular data,
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

MAX_ROWS = 50_000

REPORT_TEMPLATES = [
    {
        "id": "sales-pipeline",
        "name": "Sales Pipeline",
        "description": "Analyze your sales pipeline: opportunity stages, values, and conversion rates.",
        "questions": [
            "What is the total value of opportunities in each stage?",
            "How many opportunities were created in the last 30 days?",
            "What is the average opportunity amount by stage?",
            "Which opportunities have the highest probability of closing?",
            "What is the win rate by opportunity owner?",
        ],
    },
    {
        "id": "lead-conversion",
        "name": "Lead Conversion",
        "description": "Track lead conversion: sources, status, and conversion rates.",
        "questions": [
            "How many leads are in each status?",
            "What are the top lead sources by count?",
            "What is the lead conversion rate by source?",
            "How many leads were created each month?",
            "Which industries have the most leads?",
        ],
    },
    {
        "id": "account-overview",
        "name": "Account Overview",
        "description": "Analyze account data: industry distribution, revenue, and engagement.",
        "questions": [
            "How many accounts are in each industry?",
            "What is the total annual revenue by industry?",
            "Which accounts have the most contacts?",
            "What is the distribution of accounts by billing country?",
            "How many accounts were created each month?",
        ],
    },
    {
        "id": "campaign-roi",
        "name": "Campaign ROI",
        "description": "Measure campaign performance: budgets, leads, and return on investment.",
        "questions": [
            "What is the total budgeted cost vs actual cost per campaign?",
            "Which campaigns generated the most leads?",
            "What is the lead conversion rate per campaign?",
            "Which campaign types are most cost-effective?",
            "How many responses did each campaign receive?",
        ],
    },
    {
        "id": "support-cases",
        "name": "Support Cases",
        "description": "Analyze support case data: status, priority, and resolution times.",
        "questions": [
            "How many cases are in each status?",
            "What is the distribution of cases by priority?",
            "How many cases were created each week this month?",
            "Which case types have the most volume?",
            "What is the average time to close a case?",
        ],
    },
]

# Salesforce object fields to fetch via SOQL
_OBJECT_FIELDS = {
    "accounts": {
        "soql_object": "Account",
        "fields": [
            "Id", "Name", "Industry", "Type", "BillingCity", "BillingState",
            "BillingCountry", "NumberOfEmployees", "AnnualRevenue", "Website",
            "Phone", "CreatedDate", "LastModifiedDate",
        ],
    },
    "contacts": {
        "soql_object": "Contact",
        "fields": [
            "Id", "FirstName", "LastName", "Email", "Phone", "Title",
            "Department", "AccountId", "LeadSource", "CreatedDate", "LastModifiedDate",
        ],
    },
    "opportunities": {
        "soql_object": "Opportunity",
        "fields": [
            "Id", "Name", "Amount", "StageName", "CloseDate", "Probability",
            "Type", "LeadSource", "AccountId", "OwnerId", "CreatedDate",
            "LastModifiedDate", "IsClosed", "IsWon",
        ],
    },
    "leads": {
        "soql_object": "Lead",
        "fields": [
            "Id", "FirstName", "LastName", "Email", "Company", "Title",
            "Status", "LeadSource", "Industry", "CreatedDate", "LastModifiedDate",
            "IsConverted",
        ],
    },
    "cases": {
        "soql_object": "Case",
        "fields": [
            "Id", "Subject", "Status", "Priority", "Type", "Origin",
            "AccountId", "ContactId", "CreatedDate", "ClosedDate", "LastModifiedDate",
        ],
    },
    "tasks": {
        "soql_object": "Task",
        "fields": [
            "Id", "Subject", "Status", "Priority", "ActivityDate", "WhoId",
            "WhatId", "OwnerId", "CreatedDate", "LastModifiedDate",
        ],
    },
    "campaigns": {
        "soql_object": "Campaign",
        "fields": [
            "Id", "Name", "Type", "Status", "StartDate", "EndDate",
            "BudgetedCost", "ActualCost", "NumberOfLeads", "NumberOfConvertedLeads",
            "NumberOfResponses",
        ],
    },
    "users": {
        "soql_object": "User",
        "fields": [
            "Id", "Name", "Email", "IsActive", "ProfileId", "UserRoleId",
            "CreatedDate", "LastModifiedDate",
        ],
    },
}


def _salesforce_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}


def _soql_query_sync(
    access_token: str,
    instance_url: str,
    soql: str,
    max_records: int = MAX_ROWS,
) -> list[dict]:
    """Execute a SOQL query with pagination via nextRecordsUrl."""
    headers = _salesforce_headers(access_token)
    url = f"{instance_url}/services/data/v59.0/query/"
    all_records: list[dict] = []

    with httpx.Client(timeout=30) as client:
        params = {"q": soql}
        r = client.get(url, headers=headers, params=params)
        r.raise_for_status()
        data = r.json()

        for record in data.get("records", []):
            # Remove Salesforce metadata attributes
            clean = {k: v for k, v in record.items() if k != "attributes"}
            all_records.append(clean)

        # Paginate via nextRecordsUrl
        while data.get("nextRecordsUrl") and len(all_records) < max_records:
            next_url = f"{instance_url}{data['nextRecordsUrl']}"
            r = client.get(next_url, headers=headers)
            r.raise_for_status()
            data = r.json()
            for record in data.get("records", []):
                clean = {k: v for k, v in record.items() if k != "attributes"}
                all_records.append(clean)

    return all_records[:max_records]


def _test_connection_sync(access_token: str, instance_url: str) -> dict:
    """Test Salesforce connection by querying one Account."""
    headers = _salesforce_headers(access_token)
    url = f"{instance_url}/services/data/v59.0/query/"
    with httpx.Client(timeout=15) as client:
        r = client.get(url, headers=headers, params={"q": "SELECT Id FROM Account LIMIT 1"})
        r.raise_for_status()
        return {"ok": True}


def _discover_objects_sync(access_token: str, instance_url: str) -> dict:
    """Discover available object counts."""
    headers = _salesforce_headers(access_token)
    url = f"{instance_url}/services/data/v59.0/query/"
    counts = {}

    with httpx.Client(timeout=15) as client:
        for table_name, obj_config in _OBJECT_FIELDS.items():
            soql_object = obj_config["soql_object"]
            try:
                r = client.get(url, headers=headers, params={"q": f"SELECT COUNT() FROM {soql_object}"})
                if r.status_code == 200:
                    data = r.json()
                    counts[table_name] = data.get("totalSize", 0)
                else:
                    counts[table_name] = 0
            except Exception:
                counts[table_name] = 0

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


def _load_all_tables_sync(access_token: str, instance_url: str) -> dict[str, pd.DataFrame]:
    """Fetch all Salesforce tables and return as DataFrames."""
    tables: dict[str, pd.DataFrame] = {}

    for table_name, obj_config in _OBJECT_FIELDS.items():
        soql_object = obj_config["soql_object"]
        fields = obj_config["fields"]
        soql = f"SELECT {', '.join(fields)} FROM {soql_object}"
        try:
            records = _soql_query_sync(access_token, instance_url, soql)
            if records:
                tables[table_name] = pd.json_normalize(records)
            else:
                tables[table_name] = pd.DataFrame(columns=fields)
        except Exception:
            tables[table_name] = pd.DataFrame(columns=fields)

    return tables


async def ask_salesforce(
    access_token: str,
    instance_url: str,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Salesforce CRM Q&A."""
    loop = asyncio.get_event_loop()

    tables = await loop.run_in_executor(
        None, lambda: _load_all_tables_sync(access_token, instance_url)
    )

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

    # Build profile from opportunities table (most important for analysis)
    main_df = tables.get("opportunities", pd.DataFrame())
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
            preview_parts.append(
                f"--- {tname} (sample) ---\n"
                f"{json.dumps(tdf.head(3).to_dict(orient='records'), default=str, ensure_ascii=False)}"
            )

    system = (
        "You are an assistant that answers questions about Salesforce CRM data. "
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
        f"Salesforce CRM Data Schema:\n{schema_text}\n\n"
        f"Sample profile (opportunities/contacts):\n{profile_text}\n\n"
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
    trace["source_type"] = "salesforce"
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
