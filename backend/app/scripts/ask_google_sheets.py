"""
Answer questions about Google Sheets using an LLM.
Requires Google service account credentials in an environment variable.
Replaces ask-question-google-sheets (no Langflow).
"""
from typing import Any
import asyncio
import json
import os
import re
import sqlite3

MAX_SHEET_ROWS = 10_000


def _get_gspread_client(credentials_json: str):
    """Build gspread client from service account JSON string."""
    import gspread

    creds_dict = json.loads(credentials_json)
    return gspread.service_account_from_dict(creds_dict)


def _fetch_sheet_data_sync(
    client, spreadsheet_id: str, sheet_name: str, max_rows: int = MAX_SHEET_ROWS
) -> tuple[list[str], list[dict]]:
    """
    Fetch rows from a Google Sheet.
    Returns (columns, rows) where rows is a list of dicts (up to max_rows data rows).
    """
    spreadsheet = client.open_by_key(spreadsheet_id)
    worksheet = spreadsheet.worksheet(sheet_name)
    all_values = worksheet.get_all_values()
    if not all_values:
        return [], []
    header = [str(h) for h in all_values[0]]
    rows = []
    for row in all_values[1 : max_rows + 1]:
        padded = list(row) + [""] * (len(header) - len(row))
        rows.append(dict(zip(header, padded[: len(header)])))
    return header, rows


def _run_sql_on_rows(rows: list[dict], columns: list[str], query: str) -> list[dict]:
    """Load sheet rows into an in-memory SQLite table named 'data' and execute a SELECT query."""
    import pandas as pd

    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE", "CREATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")
    df = pd.DataFrame(rows, columns=columns)
    conn = sqlite3.connect(":memory:")
    try:
        df.to_sql("data", conn, index=False, if_exists="replace")
        cur = conn.execute(query)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()


async def ask_google_sheets(
    spreadsheet_id: str,
    sheet_name: str,
    available_columns: list[str] | None,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    credentials_json: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Fetch sheet data (via Google API), send context to LLM, return answer.
    credentials_json: service account JSON string or None to use GOOGLE_SHEETS_SERVICE_ACCOUNT.
    """
    credentials_json = credentials_json or os.environ.get("GOOGLE_SHEETS_SERVICE_ACCOUNT")
    if not credentials_json:
        raise ValueError("GOOGLE_SHEETS_SERVICE_ACCOUNT not configured")

    from app.llm.charting import build_chart_input
    from app.llm.client import chat_completion
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log
    from app.scripts.sql_utils import extract_sql_from_field

    loop = asyncio.get_event_loop()

    # Fetch real sheet data via gspread
    gspread_client = await loop.run_in_executor(None, lambda: _get_gspread_client(credentials_json))
    columns, rows = await loop.run_in_executor(
        None, lambda: _fetch_sheet_data_sync(gspread_client, spreadsheet_id, sheet_name)
    )

    if columns:
        available_columns = available_columns or columns
    columns_text = ", ".join(available_columns or [])
    schema_text = (
        f"Spreadsheet: {spreadsheet_id}, sheet: {sheet_name}. "
        f"Columns: {columns_text or 'unknown'}. "
        f"Total rows: {len(rows)}."
    )
    sample_json = json.dumps(rows[:5], ensure_ascii=False, default=str)

    system = (
        "You are an assistant that answers questions about Google Sheets data. "
        "Use only the context provided. "
        "If the question requires precise filtering or aggregation on the full sheet, you MUST provide a SQL query "
        "(in a fenced ```sql``` block) that would answer it exactly using SELECT ... FROM data. "
        "Quote column names with double quotes if they have spaces or special characters. "
        "In that case, also state that the answer requires executing the SQL on the full dataset. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Any suggested follow-up questions must be answerable using only the available columns in the schema. "
        "Do not invent fields, dimensions, or metrics that are not present in that schema. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
    ]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append(
        {
            "role": "user",
            "content": (
                f"Context: {schema_text}\n"
                f"Sample data (up to 5 rows): {sample_json}\n\n"
                f"Question: {question}"
            ),
        }
    )
    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "google_sheets"
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

    # Execute SQL on the fetched sheet data and have LLM elaborate
    chart_input = None
    if sql_query and sql_query.upper().strip().startswith("SELECT") and rows:
        try:
            result_rows = await loop.run_in_executor(
                None, lambda: _run_sql_on_rows(rows, columns, sql_query)
            )
            if result_rows is not None:
                chart_input = build_chart_input(result_rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=result_rows,
                    agent_description=agent_description,
                    source_name=source_name,
                    schema_text=schema_text,
                    llm_overrides=llm_overrides,
                    channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Erro ao executar a consulta na planilha: {e}*"

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
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


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
                return _coerce(json.loads(raw_clean[start:end + 1]), True)
            except json.JSONDecodeError:
                pass
        return _coerce({}, False)


def _extract_followups(raw: str) -> list[str]:
    follow_up = []
    for line in raw.split("\n"):
        cleaned = line.strip().replace("^[0-9]+\\.\\s*", "").replace("^-\\s*", "").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
