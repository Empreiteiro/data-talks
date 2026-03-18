"""
REST API Q&A: fetch data from a generic REST API, normalize JSON to tabular data,
then use LLM + SQL-on-DataFrame to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import math
import re
import sqlite3
import ipaddress
from urllib.parse import urlparse

import httpx
import pandas as pd

from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field

MAX_API_ROWS = 50_000


def _validate_url(url: str) -> None:
    """Basic SSRF protection: block localhost and private IPs."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    blocked_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
    if hostname.lower() in blocked_hosts:
        raise ValueError(f"Blocked URL: {hostname} is not allowed (SSRF protection)")

    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            raise ValueError(f"Blocked URL: {hostname} is a private/loopback address")
    except ValueError:
        pass  # hostname is not an IP, that's fine


def _fetch_api_data_sync(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    query_params: dict | None = None,
    body: dict | None = None,
    data_path: str | None = None,
    pagination: dict | None = None,
) -> list[dict]:
    """Fetch data from a REST API and return flat list of dicts."""
    _validate_url(url)

    all_records: list[dict] = []
    page_params = dict(query_params or {})
    page_num = 0
    max_pages = 100

    with httpx.Client(timeout=30) as client:
        while page_num < max_pages:
            if method.upper() == "POST":
                r = client.post(url, headers=headers or {}, params=page_params, json=body)
            else:
                r = client.get(url, headers=headers or {}, params=page_params)

            r.raise_for_status()
            data = r.json()

            # Navigate to data path
            records = _extract_data(data, data_path)
            if not records:
                break

            all_records.extend(records)

            if len(all_records) >= MAX_API_ROWS:
                all_records = all_records[:MAX_API_ROWS]
                break

            # Handle pagination
            if not pagination or not pagination.get("type"):
                break

            ptype = pagination["type"]
            param_name = pagination.get("paramName", "offset")
            page_size = pagination.get("pageSize", 100)

            if ptype == "offset":
                page_params[param_name] = str(len(all_records))
                if len(records) < page_size:
                    break
            elif ptype == "page":
                page_num += 1
                page_params[param_name] = str(page_num + 1)
                if len(records) < page_size:
                    break
            elif ptype == "cursor":
                cursor_path = pagination.get("cursorPath", "next_cursor")
                next_cursor = _get_nested(data, cursor_path)
                if not next_cursor:
                    break
                page_params[param_name] = str(next_cursor)
            else:
                break

            page_num += 1

    return all_records


def _extract_data(data: Any, data_path: str | None) -> list[dict]:
    """Navigate JSON response to find the data array."""
    if data_path:
        current = data
        for key in data_path.split("."):
            if isinstance(current, dict):
                current = current.get(key)
            else:
                return []
        data = current

    if isinstance(data, list):
        return [r if isinstance(r, dict) else {"value": r} for r in data]
    if isinstance(data, dict):
        return [data]
    return []


def _get_nested(data: dict, path: str) -> Any:
    """Get a nested value from a dict using dot notation."""
    current = data
    for key in path.split("."):
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def _test_request_sync(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    query_params: dict | None = None,
    body: dict | None = None,
    data_path: str | None = None,
) -> dict:
    """Execute a test request and return preview + schema."""
    _validate_url(url)

    with httpx.Client(timeout=30) as client:
        if method.upper() == "POST":
            r = client.post(url, headers=headers or {}, params=query_params or {}, json=body)
        else:
            r = client.get(url, headers=headers or {}, params=query_params or {})
        r.raise_for_status()
        data = r.json()

    records = _extract_data(data, data_path)
    if not records:
        return {"columns": [], "preview": [], "rowCount": 0}

    df = pd.json_normalize(records[:100])
    return {
        "columns": list(df.columns),
        "preview": df.head(5).to_dict(orient="records"),
        "rowCount": len(records),
    }


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
    profile = {"sample_rows": sample_rows, "columns": {}}
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile = {"type": str(series.dtype), "missing": int(series.isna().sum())}
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


async def ask_rest_api(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    query_params: dict | None = None,
    body: dict | None = None,
    data_path: str | None = None,
    pagination: dict | None = None,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    columns: list[str] | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for REST API Q&A."""
    loop = asyncio.get_event_loop()

    records = await loop.run_in_executor(
        None,
        lambda: _fetch_api_data_sync(url, method, headers, query_params, body, data_path, pagination),
    )

    df = pd.json_normalize(records) if records else pd.DataFrame()
    columns = list(df.columns)
    full_row_count = len(df)
    preview = df.head(10).to_dict(orient="records")
    sample_profile = _build_sample_profile(df.head(1000))

    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)}. "
        'Use SELECT ... FROM data. Quote column names with double quotes if they have dots or spaces.'
    )

    profile_lines = []
    for col, info in sample_profile.get("columns", {}).items():
        line = f"- {col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
        profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    system = (
        "You are an assistant that answers questions about data from a REST API. "
        "The data is loaded in a table named 'data'. "
        "For questions requiring filtering, counting, or aggregation, provide a SQL query in sqlQuery. "
        "Use standard SQL: SELECT ... FROM data. Quote column names with double quotes if needed. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"{schema_for_sql}\n\n"
        f"API: {method} {url}\n"
        f"Total rows: {full_row_count}\n"
        f"Sample profile:\n{profile_text}\n\n"
        f"Sample data (up to 5 rows):\n{json.dumps(preview[:5], default=str, ensure_ascii=False)}\n\n"
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
    trace["source_type"] = "rest_api"
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
                    chart_input = build_chart_input(rows, schema_for_sql)
                    elaborated = await elaborate_answer_with_results(
                        question=question, query_results=rows, agent_description=agent_description,
                        source_name=source_name, schema_text=schema_for_sql,
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
        question=question, candidate_questions=follow_up, schema_text=schema_for_sql,
        llm_overrides=llm_overrides, channel=channel,
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data, parsed_ok):
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_query = data.get("sqlQuery") if isinstance(data, dict) else None
        if not isinstance(answer, str): answer = ""
        if not isinstance(follow_up, list): follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_query, str): sql_query = ""
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
