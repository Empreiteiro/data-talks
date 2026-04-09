"""
Q&A for Mixpanel Data Export API — fetches event data.
Requires: Service Account Username + Secret + Project ID.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any

import httpx
import pandas as pd

from app.llm.client import chat_completion
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.ask_csv import _build_sample_profile, _format_profile, _format_schema


async def ask_mixpanel(
    service_account_username: str,
    service_account_secret: str,
    project_id: str,
    question: str = "",
    agent_description: str = "",
    source_name: str = "Mixpanel",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch Mixpanel event data and answer questions about product analytics."""
    from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    to_date = datetime.utcnow().strftime("%Y-%m-%d")

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                "https://data.mixpanel.com/api/2.0/export",
                auth=(service_account_username, service_account_secret),
                params={"from_date": from_date, "to_date": to_date, "limit": 5000},
                headers={"X-Mixpanel-Project-Id": project_id},
            )
            resp.raise_for_status()
            lines = resp.text.strip().split("\n")
            events = [json.loads(line) for line in lines if line.strip()]
    except Exception as e:
        return {"answer": f"Failed to fetch Mixpanel data: {e}", "imageUrl": None, "followUpQuestions": []}

    rows = []
    for ev in events[:5000]:
        props = ev.get("properties", {})
        rows.append({
            "event": ev.get("event", ""),
            "time": datetime.utcfromtimestamp(props.get("time", 0)).strftime("%Y-%m-%d %H:%M:%S"),
            "distinct_id": str(props.get("distinct_id", "")),
            "city": props.get("$city", ""),
            "country": props.get("$country_code", ""),
            "os": props.get("$os", ""),
            "browser": props.get("$browser", ""),
        })

    if not rows:
        return {"answer": "No Mixpanel events found for the last 30 days.", "imageUrl": None, "followUpQuestions": []}

    df = pd.DataFrame(rows)
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    profile_text = _format_profile(_build_sample_profile(df.head(1000)))

    schema_for_sql = f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). Use SELECT ... FROM data."

    system = (
        "You are an assistant that answers questions about Mixpanel product analytics events. "
        f"Schema: {schema_for_sql}\n"
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), sqlQuery (string or null)."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    user_content = f"Data profile:\n{profile_text}\n\nSample:\n{json.dumps(preview[:3], default=str)}\n\nQuestion: {question}"

    messages = [{"role": "system", "content": system}]
    if history:
        messages.extend(history[-5:])
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)

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
    follow_ups = await refine_followup_questions(follow_ups, columns, question, llm_overrides=llm_overrides, channel=channel)

    await record_log(
        action="pergunta", provider=usage.get("provider", ""), model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0), output_tokens=usage.get("output_tokens", 0),
        source=source_name, channel=channel, trace=trace,
    )

    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_ups}
