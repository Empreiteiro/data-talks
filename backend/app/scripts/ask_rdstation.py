"""
Q&A for RD Station Marketing — fetches contacts/leads via API and answers questions.
Requires: API Token.
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


async def ask_rdstation(
    api_token: str,
    question: str = "",
    agent_description: str = "",
    source_name: str = "RD Station",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch RD Station contacts and answer questions about leads."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://api.rd.services/platform/contacts",
                headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
                params={"page": 1, "page_size": 200},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        return {"answer": f"Failed to fetch RD Station data: {e}", "imageUrl": None, "followUpQuestions": []}

    contacts = data.get("contacts", data) if isinstance(data, dict) else data
    rows = []
    for c in (contacts if isinstance(contacts, list) else []):
        rows.append({
            "email": c.get("email", ""),
            "name": c.get("name", ""),
            "lifecycle_stage": c.get("lifecycle_stage", ""),
            "lead_scoring": c.get("lead_scoring", 0),
            "created_at": c.get("created_at", ""),
            "last_conversion": c.get("last_conversion", {}).get("content", {}).get("identifier", ""),
        })

    if not rows:
        return {"answer": "No contacts found in RD Station.", "imageUrl": None, "followUpQuestions": []}

    df = pd.DataFrame(rows)
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    schema_text = _format_schema(columns, preview)
    profile_text = _format_profile(_build_sample_profile(df.head(1000)))

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). "
        "Use SELECT ... FROM data."
    )

    system = (
        "You are an assistant that answers questions about RD Station Marketing contacts and leads. "
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
