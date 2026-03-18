"""
Excel Online (OneDrive/SharePoint) Q&A: fetch worksheet data via Microsoft Graph API,
load into pandas, then use LLM + SQL-on-DataFrame to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import re
import sqlite3
import tempfile

import httpx

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"


def _graph_headers(access_token: str) -> dict:
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }


def _list_excel_files_sync(access_token: str) -> list[dict]:
    """List Excel files from OneDrive root."""
    with httpx.Client() as client:
        r = client.get(
            f"{GRAPH_API_BASE}/me/drive/root/search(q='.xlsx')",
            headers=_graph_headers(access_token),
            params={"$top": "100", "$select": "id,name,size,webUrl,parentReference"},
        )
        r.raise_for_status()
        data = r.json()
    files = []
    for item in data.get("value", []):
        files.append({
            "id": item.get("id", ""),
            "name": item.get("name", ""),
            "size": item.get("size", 0),
            "webUrl": item.get("webUrl", ""),
            "driveId": item.get("parentReference", {}).get("driveId", ""),
        })
    return files


def _list_sheets_sync(access_token: str, drive_id: str, item_id: str) -> list[dict]:
    """List worksheets in an Excel file."""
    with httpx.Client() as client:
        r = client.get(
            f"{GRAPH_API_BASE}/drives/{drive_id}/items/{item_id}/workbook/worksheets",
            headers=_graph_headers(access_token),
        )
        r.raise_for_status()
        data = r.json()
    sheets = []
    for ws in data.get("value", []):
        sheets.append({
            "id": ws.get("id", ""),
            "name": ws.get("name", ""),
        })
    return sheets


def _fetch_sheet_data_sync(
    access_token: str,
    drive_id: str,
    item_id: str,
    sheet_name: str,
) -> dict:
    """Fetch used range from a worksheet. Returns { columns, rows, rowCount }."""
    import pandas as pd

    with httpx.Client() as client:
        r = client.get(
            f"{GRAPH_API_BASE}/drives/{drive_id}/items/{item_id}/workbook/worksheets/{sheet_name}/usedRange",
            headers=_graph_headers(access_token),
        )
        r.raise_for_status()
        data = r.json()

    values = data.get("values", [])
    if not values:
        return {"columns": [], "rows": [], "rowCount": 0}

    headers = [str(h) for h in values[0]]
    rows = []
    for row_vals in values[1:]:
        row = {}
        for i, val in enumerate(row_vals):
            col = headers[i] if i < len(headers) else f"col_{i}"
            row[col] = val
        rows.append(row)

    return {
        "columns": headers,
        "rows": rows,
        "rowCount": len(rows),
    }


def _build_sample_profile(df) -> dict:
    """Build a lightweight profile of the DataFrame."""
    import math

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
                def _sf(v):
                    try:
                        v = float(v)
                        return v if math.isfinite(v) else None
                    except (TypeError, ValueError):
                        return None
                col_profile["numeric"] = {
                    "min": _sf(numeric.min()),
                    "max": _sf(numeric.max()),
                    "mean": _sf(numeric.mean()),
                }
        profile["columns"][str(col)] = col_profile
    return profile


def _run_sql_on_df(sql: str, df, max_rows: int = 500) -> list[dict]:
    """Execute SQL on a pandas DataFrame using an in-memory SQLite database."""
    conn = sqlite3.connect(":memory:")
    try:
        df.to_sql("data", conn, index=False, if_exists="replace")
        cursor = conn.execute(sql)
        columns = [desc[0] for desc in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchmany(max_rows)]
        return rows
    finally:
        conn.close()


async def ask_excel_online(
    access_token: str | None,
    drive_id: str,
    item_id: str,
    file_name: str = "",
    sheet_name: str = "Sheet1",
    columns: list[str] | None = None,
    preview: list[dict] | None = None,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for Excel Online Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not access_token:
        raise ValueError("Microsoft access token is required")

    loop = asyncio.get_event_loop()

    # Fetch data
    sheet_data = await loop.run_in_executor(
        None,
        lambda: _fetch_sheet_data_sync(access_token, drive_id, item_id, sheet_name),
    )
    fetched_columns = sheet_data.get("columns", [])
    all_rows = sheet_data.get("rows", [])

    if not columns:
        columns = fetched_columns
    if not preview:
        preview = all_rows[:5]

    import pandas as pd
    df = pd.DataFrame(all_rows) if all_rows else pd.DataFrame(columns=columns)

    sample_profile = _build_sample_profile(df)
    schema_text = (
        f"File: {file_name}\n"
        f"Sheet: {sheet_name}\n"
        f"Columns: {columns}\n"
        f"Row count: {len(df)}\n"
        f"Profile: {json.dumps(sample_profile, default=str)}\n"
        f"Preview (up to 5): {json.dumps(preview[:5], default=str, ensure_ascii=False)}"
    )

    system = (
        "You are a data analyst assistant. The user has an Excel Online spreadsheet. "
        "You are given the column names and a preview of the data below. "
        'Answer the question using a SQL query on a SQLite table named "data". '
        "Return ONLY valid JSON with keys: "
        '"answer" (string — brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"sqlQuery" (string — a SELECT query on the \"data\" table, or null). '
        "Quote column names with double quotes if they contain spaces. "
        "Only produce SELECT statements. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append(
        {"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"}
    )

    raw_answer, usage, trace = await chat_completion(
        messages, max_tokens=2048, llm_overrides=llm_overrides
    )
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "excel_online"
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
    sql_query = (parsed.get("sqlQuery") or "").strip()

    chart_input = None
    if sql_query:
        try:
            rows = _run_sql_on_df(sql_query, df)
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
            answer = f"{answer}\n\n*Error executing query: {e}*"

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
    return {
        "answer": answer,
        "imageUrl": None,
        "followUpQuestions": follow_up,
        "chartInput": chart_input,
    }


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data: Any, parsed_ok: bool) -> dict[str, Any]:
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
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "sqlQuery": sql_query,
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
                return _coerce(json.loads(raw_clean[start : end + 1]), True)
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
