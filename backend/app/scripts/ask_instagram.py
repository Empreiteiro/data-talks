"""
Q&A for Instagram Graph API — fetches media posts with engagement metrics.
Requires: Access Token + Instagram Account ID.
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

MEDIA_FIELDS = "id,caption,media_type,timestamp,like_count,comments_count,permalink"


async def ask_instagram(
    access_token: str,
    instagram_account_id: str,
    question: str = "",
    agent_description: str = "",
    source_name: str = "Instagram",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch Instagram media posts and answer questions about engagement."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://graph.facebook.com/v19.0/{instagram_account_id}/media",
                params={"fields": MEDIA_FIELDS, "access_token": access_token, "limit": 100},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        return {"answer": f"Failed to fetch Instagram data: {e}", "imageUrl": None, "followUpQuestions": []}

    rows = []
    for m in data.get("data", []):
        rows.append({
            "post_id": m.get("id", ""),
            "caption": (m.get("caption") or "")[:200],
            "media_type": m.get("media_type", ""),
            "timestamp": m.get("timestamp", ""),
            "likes": m.get("like_count", 0),
            "comments": m.get("comments_count", 0),
            "permalink": m.get("permalink", ""),
        })

    if not rows:
        return {"answer": "No Instagram posts found.", "imageUrl": None, "followUpQuestions": []}

    df = pd.DataFrame(rows)
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    profile_text = _format_profile(_build_sample_profile(df.head(1000)))

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). "
        "Use SELECT ... FROM data."
    )

    system = (
        "You are an assistant that answers questions about Instagram media posts and engagement. "
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
