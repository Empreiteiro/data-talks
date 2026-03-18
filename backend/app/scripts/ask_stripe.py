"""
Stripe Q&A: fetch data from Stripe API, normalize to tabular data,
then use LLM + SQL-on-DataFrame to answer natural language questions.
Supports 9 resource tables and 5 report templates.
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

STRIPE_API_BASE = "https://api.stripe.com/v1"
MAX_RECORDS_PER_TABLE = 10_000

# Standard fields per resource (used for schema hints)
STRIPE_TABLE_FIELDS: dict[str, list[str]] = {
    "customers": [
        "id", "email", "name", "phone", "created", "currency", "delinquent", "default_source",
    ],
    "subscriptions": [
        "id", "customer", "status", "current_period_start", "current_period_end",
        "created", "cancel_at_period_end", "plan_id", "plan_amount", "plan_interval",
    ],
    "invoices": [
        "id", "customer", "subscription", "status", "amount_due", "amount_paid",
        "currency", "created", "due_date", "paid",
    ],
    "charges": [
        "id", "customer", "amount", "currency", "status", "created",
        "payment_method", "description", "refunded",
    ],
    "products": [
        "id", "name", "description", "active", "created", "default_price", "type",
    ],
    "prices": [
        "id", "product", "active", "currency", "unit_amount", "type",
        "recurring_interval", "recurring_interval_count", "created",
    ],
    "refunds": [
        "id", "charge", "amount", "currency", "status", "reason", "created",
    ],
    "payouts": [
        "id", "amount", "currency", "status", "created", "arrival_date", "method", "type",
    ],
    "disputes": [
        "id", "charge", "amount", "currency", "status", "reason", "created",
    ],
}

STRIPE_REPORT_TEMPLATES: dict[str, dict[str, str]] = {
    "mrr_revenue": {
        "name": "MRR & Revenue",
        "question": (
            "Calculate the Monthly Recurring Revenue (MRR) from active subscriptions, "
            "total revenue from charges in the last 30 days, and average revenue per customer."
        ),
    },
    "subscription_analytics": {
        "name": "Subscription Analytics",
        "question": (
            "Provide subscription analytics: count by status (active, canceled, past_due, trialing), "
            "churn rate, new subscriptions in last 30 days, and average subscription value."
        ),
    },
    "payment_health": {
        "name": "Payment Health",
        "question": (
            "Analyze payment health: successful vs failed charge rate, total refund amount, "
            "dispute count and rate, and average charge amount."
        ),
    },
    "customer_insights": {
        "name": "Customer Insights",
        "question": (
            "Provide customer insights: total customers, new customers in last 30 days, "
            "customers with active subscriptions, delinquent customer count, and top 5 customers by total charges."
        ),
    },
    "payout_summary": {
        "name": "Payout Summary",
        "question": (
            "Summarize payouts: total payout amount, count by status (paid, pending, in_transit, failed), "
            "average payout amount, and payout frequency."
        ),
    },
}


def _fetch_stripe_resource_sync(
    api_key: str,
    resource: str,
    limit: int = MAX_RECORDS_PER_TABLE,
) -> list[dict]:
    """Fetch all records for a Stripe resource with cursor-based pagination."""
    all_records: list[dict] = []
    params: dict[str, str] = {"limit": "100"}
    url = f"{STRIPE_API_BASE}/{resource}"
    headers = {"Authorization": f"Bearer {api_key}"}

    with httpx.Client(timeout=30) as client:
        while True:
            r = client.get(url, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()

            records = data.get("data", [])
            if not records:
                break

            all_records.extend(records)

            if len(all_records) >= limit:
                all_records = all_records[:limit]
                break

            if not data.get("has_more", False):
                break

            # Cursor-based pagination: use last item's id
            params["starting_after"] = records[-1]["id"]

    return all_records


def _test_stripe_connection_sync(api_key: str) -> dict:
    """Test Stripe connection by fetching balance."""
    url = f"{STRIPE_API_BASE}/balance"
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=15) as client:
        r = client.get(url, headers=headers)
        r.raise_for_status()
        return r.json()


def _discover_stripe_resources_sync(api_key: str, tables: list[str]) -> list[dict]:
    """For each table, fetch a small sample to get row count and preview."""
    headers = {"Authorization": f"Bearer {api_key}"}
    result = []
    with httpx.Client(timeout=30) as client:
        for table in tables:
            try:
                url = f"{STRIPE_API_BASE}/{table}"
                r = client.get(url, headers=headers, params={"limit": "5"})
                r.raise_for_status()
                data = r.json()
                records = data.get("data", [])
                df = pd.json_normalize(records, sep="_") if records else pd.DataFrame()
                result.append({
                    "table": table,
                    "fields": STRIPE_TABLE_FIELDS.get(table, list(df.columns) if not df.empty else []),
                    "has_more": data.get("has_more", False),
                    "sample_count": len(records),
                    "preview": df.head(3).to_dict(orient="records") if not df.empty else [],
                })
            except Exception as e:
                result.append({
                    "table": table,
                    "fields": STRIPE_TABLE_FIELDS.get(table, []),
                    "has_more": False,
                    "sample_count": 0,
                    "preview": [],
                    "_error": str(e),
                })
    return result


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
    profile: dict[str, Any] = {"sample_rows": sample_rows, "columns": {}}
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile: dict[str, Any] = {"type": str(series.dtype), "missing": int(series.isna().sum())}
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


async def ask_stripe(
    api_key: str,
    tables: list[str],
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Main entry point for Stripe Q&A.

    api_key: Stripe Secret API Key (sk_...).
    tables: list of Stripe resource names to query (e.g. ["customers", "subscriptions"]).
    table_infos: cached schema [{ "table": "x", "fields": [...] }].
    """
    loop = asyncio.get_event_loop()

    # Fetch all data for selected tables
    dataframes: dict[str, pd.DataFrame] = {}
    for table_name in tables:
        records = await loop.run_in_executor(
            None,
            lambda t=table_name: _fetch_stripe_resource_sync(api_key, t),
        )
        df = pd.json_normalize(records, sep="_") if records else pd.DataFrame()
        dataframes[table_name] = df

    # Build schema for LLM
    conn = sqlite3.connect(":memory:")
    schema_parts = []
    for table_name, df in dataframes.items():
        if not df.empty:
            df.to_sql(table_name, conn, index=False, if_exists="replace")
        else:
            # Create empty table with known fields
            fields = STRIPE_TABLE_FIELDS.get(table_name, [])
            if fields:
                cols_sql = ", ".join(f'"{f}" TEXT' for f in fields)
                conn.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({cols_sql})")

        columns = list(df.columns) if not df.empty else STRIPE_TABLE_FIELDS.get(table_name, [])
        schema_parts.append(f"Table '{table_name}': columns {columns} ({len(df)} rows)")

        preview = df.head(3).to_dict(orient="records") if not df.empty else []
        if preview:
            schema_parts.append(
                f"  Sample data: {json.dumps(preview[:3], default=str, ensure_ascii=False)}"
            )

    schema_text = "\n".join(schema_parts)

    # Build profile for numeric hints
    profile_lines = []
    for table_name, df in dataframes.items():
        if df.empty:
            continue
        profile = _build_sample_profile(df.head(1000))
        for col, info in profile.get("columns", {}).items():
            line = f"- {table_name}.{col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
            if "numeric" in info:
                n = info["numeric"]
                line += f" [min={n.get('min')}, max={n.get('max')}, mean={n.get('mean')}]"
            profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    # Build report templates section
    report_hints = "\n".join(
        f"- {tpl['name']}: {tpl['question']}"
        for tpl in STRIPE_REPORT_TEMPLATES.values()
    )

    system = (
        "You are a data analyst assistant for Stripe data. "
        "The user's Stripe data is loaded into SQLite tables. "
        "Monetary amounts in Stripe are in cents (divide by 100 for dollars). "
        "Timestamps are Unix epoch seconds (use datetime() to convert). "
        "For questions requiring filtering, counting, or aggregation, provide a SQL query in sqlQuery. "
        "Use standard SQL: SELECT ... FROM table_name. Quote column names with double quotes if they have dots or special chars. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). Do not include any extra text outside the JSON.\n\n"
        f"Available report templates:\n{report_hints}"
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"Stripe Data Schema:\n{schema_text}\n\n"
        f"Column profile:\n{profile_text}\n\n"
        f"User question: {question}"
    )

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "stripe"
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
                answer = f"{answer}\n\n*Error executing SQL on Stripe data: {e}*"
    finally:
        conn.close()

    if not parsed["parsed_ok"] and not answer:
        answer = raw_answer

    follow_up = await refine_followup_questions(
        question=question,
        candidate_questions=follow_up,
        schema_text=schema_text,
        llm_overrides=llm_overrides,
        channel=channel,
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
