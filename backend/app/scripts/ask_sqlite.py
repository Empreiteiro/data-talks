"""
SQLite file Q&A: open an uploaded .db/.sqlite file, introspect tables,
generate SQL via LLM, and execute read-only queries.
Reuses patterns from ask_sql.py adapted for local SQLite files.
"""
from typing import Any
import asyncio
import json
import re
import sqlite3
from pathlib import Path

from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field


def _introspect_sqlite_sync(db_path: str) -> list[dict]:
    """Introspect a SQLite file: list tables, columns, and preview rows."""
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        tables = [row[0] for row in cur.fetchall()]

        result = []
        for table in tables:
            cur.execute(f'PRAGMA table_info("{table}")')
            columns = [row[1] for row in cur.fetchall()]

            cur.execute(f'SELECT * FROM "{table}" LIMIT 5')
            desc = [d[0] for d in cur.description]
            preview_rows = [dict(zip(desc, row)) for row in cur.fetchall()]

            cur.execute(f'SELECT COUNT(*) FROM "{table}"')
            row_count = cur.fetchone()[0]

            result.append({
                "table": table,
                "columns": columns,
                "preview_rows": _safe_serialize(preview_rows),
                "rowCount": row_count,
            })
        return result
    finally:
        conn.close()


def _safe_serialize(rows: list[dict]) -> list[dict]:
    safe_rows = []
    for row in rows:
        safe_row = {}
        for k, v in row.items():
            if v is None:
                safe_row[k] = None
            elif isinstance(v, bytes):
                safe_row[k] = v.hex()[:100]
            else:
                safe_row[k] = v
        safe_rows.append(safe_row)
    return safe_rows


def _run_query_sync(db_path: str, sql: str, max_rows: int = 500) -> list[dict]:
    """Execute a read-only SQL query on a SQLite file."""
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE", "CREATE"):
        if forbidden in sql_upper:
            raise ValueError("Only SELECT queries are allowed")

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(sql)
        desc = [d[0] for d in cur.description]
        rows = [dict(zip(desc, row)) for row in cur.fetchmany(max_rows)]
        return _safe_serialize(rows)
    finally:
        conn.close()


async def ask_sqlite(
    file_path: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    data_files_dir: str = "./data_files",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
    sql_mode: bool = False,
) -> dict[str, Any]:
    """Main entry point for SQLite file Q&A."""
    from app.services.storage import get_storage
    full_path = str(get_storage().local_path(file_path))
    if not Path(full_path).exists():
        raise FileNotFoundError(f"SQLite file not found: {file_path}")

    loop = asyncio.get_event_loop()

    if not table_infos or not any(ti.get("columns") for ti in table_infos):
        table_infos = await loop.run_in_executor(
            None, lambda: _introspect_sqlite_sync(full_path)
        )

    schema_parts = [f"SQLite database: {source_name or file_path}"]
    for ti in (table_infos or []):
        table_name = ti.get("table", "")
        cols = ti.get("columns", [])
        schema_parts.append(f"\nTable '{table_name}': columns {cols}")
        preview = ti.get("preview_rows", [])
        if preview:
            schema_parts.append(f"  Preview: {json.dumps(preview[:3], ensure_ascii=False, default=str)}")
    schema_text = "\n".join(schema_parts)

    system = (
        "You are a data analyst assistant. The user has a SQLite database. "
        "You are given the table schemas below. "
        "Answer the question by writing a SQL query (SQLite dialect). "
        "Return ONLY valid JSON with keys: "
        '"answer" (string), "followUpQuestions" (array of up to 3 strings), '
        '"sqlQuery" (string — a SELECT query, or null). '
        "Only produce SELECT statements. Never modify data. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"
    if sql_mode:
        system += "\nSQL mode is enabled: always include a SQL query."

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "sqlite"
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
    if sql_query:
        try:
            rows = await loop.run_in_executor(
                None, lambda: _run_query_sync(full_path, sql_query)
            )
            if rows:
                chart_input = build_chart_input(rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question, query_results=rows, agent_description=agent_description,
                    source_name=source_name, schema_text=schema_text,
                    llm_overrides=llm_overrides, channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Error executing query: {e}*"

    if not parsed["parsed_ok"] and not answer:
        answer = raw_answer

    follow_up = await refine_followup_questions(
        question=question, candidate_questions=follow_up, schema_text=schema_text,
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
