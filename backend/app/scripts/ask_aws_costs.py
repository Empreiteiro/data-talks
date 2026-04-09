"""
Q&A for AWS Cost Explorer — fetches cost data via boto3 and answers questions.
Requires: AWS Access Key ID + Secret Access Key + Region.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from app.llm.client import chat_completion
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.ask_csv import _build_sample_profile, _format_profile, _format_schema


async def ask_aws_costs(
    access_key_id: str,
    secret_access_key: str,
    region: str = "us-east-1",
    question: str = "",
    agent_description: str = "",
    source_name: str = "AWS Cost Explorer",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch AWS costs and answer questions about spending."""
    try:
        import boto3
    except ImportError:
        return {
            "answer": "The boto3 library is required for AWS Cost Explorer. Install it with: pip install boto3",
            "imageUrl": None,
            "followUpQuestions": [],
        }

    # Fetch cost data for the last 90 days
    client = boto3.client(
        "ce",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=region,
    )

    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    start_date = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        response = client.get_cost_and_usage(
            TimePeriod={"Start": start_date, "End": end_date},
            Granularity="DAILY",
            Metrics=["UnblendedCost", "UsageQuantity"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )
    except Exception as e:
        return {
            "answer": f"Failed to fetch AWS cost data: {e}",
            "imageUrl": None,
            "followUpQuestions": [],
        }

    # Flatten into rows
    rows = []
    for result in response.get("ResultsByTime", []):
        period_start = result["TimePeriod"]["Start"]
        for group in result.get("Groups", []):
            service = group["Keys"][0]
            cost = float(group["Metrics"]["UnblendedCost"]["Amount"])
            usage = float(group["Metrics"]["UsageQuantity"]["Amount"])
            rows.append({
                "date": period_start,
                "service": service,
                "cost_usd": round(cost, 4),
                "usage_quantity": round(usage, 4),
            })

    if not rows:
        return {
            "answer": "No AWS cost data found for the last 90 days.",
            "imageUrl": None,
            "followUpQuestions": [],
        }

    df = pd.DataFrame(rows)

    # Load into SQLite for SQL queries
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    schema_text = _format_schema(columns, preview)
    sample_profile = _build_sample_profile(df.head(1000))
    profile_text = _format_profile(sample_profile)

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). "
        "Columns: date (YYYY-MM-DD), service (AWS service name), cost_usd (daily cost in USD), usage_quantity. "
        "Use SELECT ... FROM data."
    )

    system = (
        "You are an assistant that answers questions about AWS cloud spending data. "
        "The data contains daily costs by AWS service for the last 90 days. "
        f"Schema: {schema_for_sql}\n"
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null)."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    user_content = (
        f"Data profile:\n{profile_text}\n\n"
        f"Sample:\n{json.dumps(preview[:3], default=str)}\n\n"
        f"Question: {question}"
    )

    messages = [{"role": "system", "content": system}]
    if history:
        messages.extend(history[-5:])
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)

    # Parse and execute SQL if present
    try:
        parsed = json.loads(raw_answer)
    except json.JSONDecodeError:
        parsed = {"answer": raw_answer, "followUpQuestions": [], "sqlQuery": None}

    answer = parsed.get("answer", raw_answer)
    sql_query = parsed.get("sqlQuery")
    follow_ups = parsed.get("followUpQuestions", [])

    if sql_query:
        try:
            result_df = pd.read_sql_query(sql_query, conn)
            if not result_df.empty:
                answer = await elaborate_answer_with_results(
                    question, answer, result_df.to_dict(orient="records")[:50],
                    source_name=source_name, llm_overrides=llm_overrides, channel=channel,
                )
        except Exception:
            pass

    conn.close()

    follow_ups = await refine_followup_questions(
        follow_ups, columns, question, llm_overrides=llm_overrides, channel=channel,
    )

    await record_log(
        action="pergunta", provider=usage.get("provider", ""),
        model=usage.get("model", ""), input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0), source=source_name, channel=channel, trace=trace,
    )

    return {
        "answer": answer,
        "imageUrl": None,
        "followUpQuestions": follow_ups,
    }
