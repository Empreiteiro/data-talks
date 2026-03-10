"""
Answer questions about an SQL database using an LLM (generates/executes SQL when safe).
Replaces ask-question-sql without Langflow.
"""
from typing import Any
import asyncio
import json
import re

MAX_ROWS_FETCH = 500


def _run_query_sync(connection_string: str, query: str) -> list[dict]:
    """Execute SELECT-only query and return rows (up to MAX_ROWS_FETCH)."""
    from sqlalchemy import create_engine, text

    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")

    engine = create_engine(connection_string)
    with engine.connect() as conn:
        result = conn.execute(text(query))
        rows = result.mappings().fetchmany(MAX_ROWS_FETCH)
    return [dict(r) for r in rows]


async def ask_sql(
    connection_string: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
    sql_mode: bool = False,
) -> dict[str, Any]:
    """
    connection_string: database URL (e.g. postgresql://...).
    table_infos: [{ "table": "x", "columns": [...] }] for LLM context.
    """
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log
    from app.scripts.sql_utils import extract_sql_from_field

    loop = asyncio.get_event_loop()

    schema_text = ""
    table_names_list = []
    if table_infos:
        for t in table_infos:
            tbl = t.get("table", "")
            cols = t.get("columns", [])
            schema_text += f"Table {tbl}: columns {cols}\n"
            if tbl:
                table_names_list.append(tbl)

    system = (
        "You are an assistant that answers questions about an SQL database. "
        "CRITICAL: You may ONLY use the tables explicitly listed in the schema. "
        "Do NOT reference any table that is not in the schema—the database has only these tables. "
        "If the question requires a table not in the schema, explain that the data is not available and suggest what would be needed. "
        "When the question can be answered with the available tables, provide a SQL query "
        "(SELECT only, in a fenced ```sql``` block). "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Do not invent tables, fields, or columns. "
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
    schema_suffix = ""
    if table_names_list:
        schema_suffix = f"\n\nAvailable tables ONLY (use no other): {', '.join(table_names_list)}"
    messages.append({
        "role": "user",
        "content": f"Schema:\n{schema_text}{schema_suffix}\n\nQuestion: {question}",
    })
    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "sql"
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

    # Execute SELECT and have LLM elaborate answer from results (unless sql_mode: return raw SQL)
    chart_input = None
    if sql_mode and sql_query:
        answer = sql_query
    elif sql_query and sql_query.upper().startswith("SELECT"):
        try:
            rows = await loop.run_in_executor(
                None, lambda: _run_query_sync(connection_string, sql_query)
            )
            if rows is not None:
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
            answer = f"{answer}\n\n*Erro ao executar a consulta SQL: {e}*"

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
