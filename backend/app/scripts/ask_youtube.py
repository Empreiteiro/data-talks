"""
Q&A for YouTube Data API v3 — fetches video stats for a channel.
Requires: API Key + Channel ID.
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

BASE_URL = "https://www.googleapis.com/youtube/v3"


async def ask_youtube(
    api_key: str,
    channel_id: str,
    question: str = "",
    agent_description: str = "",
    source_name: str = "YouTube",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Fetch YouTube video stats and answer questions about channel performance."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Get uploads playlist
            ch_resp = await client.get(f"{BASE_URL}/channels", params={
                "key": api_key, "id": channel_id, "part": "contentDetails",
            })
            ch_resp.raise_for_status()
            uploads_id = ch_resp.json()["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

            # Get video IDs
            pl_resp = await client.get(f"{BASE_URL}/playlistItems", params={
                "key": api_key, "playlistId": uploads_id, "part": "contentDetails", "maxResults": 50,
            })
            pl_resp.raise_for_status()
            video_ids = [i["contentDetails"]["videoId"] for i in pl_resp.json().get("items", [])]

            if not video_ids:
                return {"answer": "No videos found on this channel.", "imageUrl": None, "followUpQuestions": []}

            # Get video stats
            v_resp = await client.get(f"{BASE_URL}/videos", params={
                "key": api_key, "id": ",".join(video_ids), "part": "snippet,statistics,contentDetails",
            })
            v_resp.raise_for_status()
            videos = v_resp.json().get("items", [])
    except Exception as e:
        return {"answer": f"Failed to fetch YouTube data: {e}", "imageUrl": None, "followUpQuestions": []}

    rows = []
    for v in videos:
        s = v.get("statistics", {})
        rows.append({
            "video_id": v["id"],
            "title": v["snippet"].get("title", ""),
            "published_at": v["snippet"].get("publishedAt", ""),
            "duration": v["contentDetails"].get("duration", ""),
            "views": int(s.get("viewCount", 0)),
            "likes": int(s.get("likeCount", 0)),
            "comments": int(s.get("commentCount", 0)),
        })

    df = pd.DataFrame(rows)
    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    columns = list(df.columns)
    preview = df.head(10).to_dict(orient="records")
    profile_text = _format_profile(_build_sample_profile(df.head(1000)))

    schema_for_sql = f"Table 'data' with columns: {', '.join(columns)} ({len(df)} rows). Use SELECT ... FROM data."

    system = (
        "You are an assistant that answers questions about YouTube channel video performance. "
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
