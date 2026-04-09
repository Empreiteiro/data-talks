"""
Q&A for Google Ads API — fetches campaign performance via REST API with OAuth2.
Requires: Developer Token, Customer ID, Refresh Token, Client ID, Client Secret.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

import httpx
import pandas as pd

from app.llm.client import chat_completion
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.ask_csv import _build_sample_profile, _format_profile, _format_schema

GAQL_QUERY = (
    "SELECT campaign.name, metrics.impressions, metrics.clicks, "
    "metrics.cost_micros, metrics.conversions, segments.date "
    "FROM campaign WHERE segments.date DURING LAST_90_DAYS"
)


async def ask_google_ads(
    developer_token: str,
    customer_id: str,
    refresh_token: str,
    client_id: str,
    client_secret: str,
    question: str = "",
    agent_description: str = "",
    source_name: str = "Google Ads",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch Google Ads campaign performance and answer questions."""
    cid = customer_id.replace("-", "")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Refresh OAuth2 token
            token_resp = await client.post("https://oauth2.googleapis.com/token", data={
                "grant_type": "refresh_token", "refresh_token": refresh_token,
                "client_id": client_id, "client_secret": client_secret,
            })
            token_resp.raise_for_status()
            access_token = token_resp.json()["access_token"]

            # Query Google Ads
            resp = await client.post(
                f"https://googleads.googleapis.com/v16/customers/{cid}/googleAds:searchStream",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "developer-token": developer_token,
                },
                json={"query": GAQL_QUERY},
            )
            resp.raise_for_status()
            results = resp.json()
    except Exception as e:
        return {"answer": f"Failed to fetch Google Ads data: {e}", "imageUrl": None, "followUpQuestions": []}

    rows = []
    for batch in (results if isinstance(results, list) else [results]):
        for row in batch.get("results", []):
            m = row.get("metrics", {})
            rows.append({
                "campaign": row.get("campaign", {}).get("name", ""),
                "date": row.get("segments", {}).get("date", ""),
                "impressions": int(m.get("impressions", 0)),
                "clicks": int(m.get("clicks", 0)),
                "cost": round(int(m.get("costMicros", 0)) / 1_000_000, 2),
                "conversions": round(float(m.get("conversions", 0)), 2),
            })

    if not rows:
        return {"answer": "No Google Ads data found for the last 90 days.", "imageUrl": None, "followUpQuestions": []}

    df = pd.DataFrame(rows)
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    profile_text = _format_profile(_build_sample_profile(df.head(1000)))

    schema_for_sql = f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). Use SELECT ... FROM data."

    system = (
        "You are an assistant that answers questions about Google Ads campaign performance. "
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
