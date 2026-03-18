"""
Snowflake Q&A: connect to Snowflake, generate SQL via LLM, execute read-only queries,
and return natural language answers with optional chart data.
"""
from typing import Any
import asyncio
import json
import re


def _get_snowflake_connection(
    account: str,
    user: str,
    password: str,
    warehouse: str = "",
    database: str = "",
    schema: str = "",
):
    """Return a snowflake-connector-python connection."""
    import snowflake.connector

    conn_params = {
        "account": account,
        "user": user,
        "password": password,
    }
    if warehouse:
        conn_params["warehouse"] = warehouse
    if database:
        conn_params["database"] = database
    if schema:
        conn_params["schema"] = schema

    return snowflake.connector.connect(**conn_params)


def _test_connection_sync(account: str, user: str, password: str) -> bool:
    """Test if Snowflake credentials are valid."""
    conn = _get_snowflake_connection(account, user, password)
    try:
        cur = conn.cursor()
        cur.execute("SELECT CURRENT_VERSION()")
        cur.fetchone()
        return True
    finally:
        conn.close()


def _list_warehouses_sync(account: str, user: str, password: str) -> list[str]:
    """List available warehouses."""
    conn = _get_snowflake_connection(account, user, password)
    try:
        cur = conn.cursor()
        cur.execute("SHOW WAREHOUSES")
        return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def _list_databases_sync(account: str, user: str, password: str) -> list[str]:
    """List available databases."""
    conn = _get_snowflake_connection(account, user, password)
    try:
        cur = conn.cursor()
        cur.execute("SHOW DATABASES")
        return [row[1] for row in cur.fetchall()]
    finally:
        conn.close()


def _list_schemas_sync(account: str, user: str, password: str, database: str) -> list[str]:
    """List schemas in a database."""
    conn = _get_snowflake_connection(account, user, password, database=database)
    try:
        cur = conn.cursor()
        cur.execute(f"SHOW SCHEMAS IN DATABASE \"{database}\"")
        return [row[1] for row in cur.fetchall()]
    finally:
        conn.close()


def _list_tables_sync(
    account: str, user: str, password: str, database: str, schema: str
) -> list[str]:
    """List tables in a schema."""
    conn = _get_snowflake_connection(account, user, password, database=database, schema=schema)
    try:
        cur = conn.cursor()
        cur.execute(f"SHOW TABLES IN SCHEMA \"{database}\".\"{schema}\"")
        return [row[1] for row in cur.fetchall()]
    finally:
        conn.close()


def _fetch_table_infos_sync(
    account: str,
    user: str,
    password: str,
    warehouse: str,
    database: str,
    schema: str,
    tables: list[str],
) -> list[dict]:
    """Fetch column info and preview rows for each table."""
    conn = _get_snowflake_connection(
        account, user, password, warehouse=warehouse, database=database, schema=schema
    )
    try:
        result = []
        cur = conn.cursor()
        for table_name in tables:
            try:
                full_name = f'"{database}"."{schema}"."{table_name}"'
                cur.execute(f"DESCRIBE TABLE {full_name}")
                columns = [row[0] for row in cur.fetchall()]

                cur.execute(f"SELECT * FROM {full_name} LIMIT 5")
                desc = [d[0] for d in cur.description]
                preview_rows = [dict(zip(desc, row)) for row in cur.fetchall()]

                result.append({
                    "table": table_name,
                    "columns": columns,
                    "preview_rows": _safe_serialize(preview_rows),
                })
            except Exception as e:
                result.append({
                    "table": table_name,
                    "columns": [],
                    "preview_rows": [],
                    "_error": str(e),
                })
        return result
    finally:
        conn.close()


def _safe_serialize(rows: list[dict]) -> list[dict]:
    """Ensure all values are JSON-serializable."""
    import datetime
    from decimal import Decimal

    safe_rows = []
    for row in rows:
        safe_row = {}
        for k, v in row.items():
            if v is None:
                safe_row[k] = None
            elif isinstance(v, (datetime.datetime, datetime.date)):
                safe_row[k] = v.isoformat()
            elif isinstance(v, Decimal):
                safe_row[k] = float(v)
            elif isinstance(v, bytes):
                safe_row[k] = v.hex()
            else:
                safe_row[k] = v
        safe_rows.append(safe_row)
    return safe_rows


def _run_query_sync(
    account: str,
    user: str,
    password: str,
    warehouse: str,
    database: str,
    schema: str,
    sql: str,
    max_rows: int = 500,
) -> list[dict]:
    """Execute a read-only SQL query on Snowflake."""
    sql_upper = sql.strip().upper()
    if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
        raise ValueError("Only SELECT queries are allowed")

    conn = _get_snowflake_connection(
        account, user, password, warehouse=warehouse, database=database, schema=schema
    )
    try:
        cur = conn.cursor()
        cur.execute(sql)
        desc = [d[0] for d in cur.description]
        rows = [dict(zip(desc, row)) for row in cur.fetchmany(max_rows)]
        return _safe_serialize(rows)
    finally:
        conn.close()


async def ask_snowflake(
    account: str,
    user: str,
    password: str,
    warehouse: str,
    database: str,
    schema: str,
    tables: list[str],
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
    sql_mode: bool = False,
) -> dict[str, Any]:
    """Main entry point for Snowflake Q&A."""
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    loop = asyncio.get_event_loop()

    if not table_infos or not any(ti.get("columns") for ti in table_infos):
        table_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_table_infos_sync(account, user, password, warehouse, database, schema, tables),
        )

    schema_parts = [
        f"Snowflake Account: {account}",
        f"Database: {database}, Schema: {schema}, Warehouse: {warehouse}",
    ]
    for ti in (table_infos or []):
        table_name = ti.get("table", "")
        cols = ti.get("columns", [])
        schema_parts.append(f"\nTable '{database}.{schema}.{table_name}': columns {cols}")
        preview = ti.get("preview_rows", [])
        if preview:
            schema_parts.append(
                f"  Preview (up to 5 rows): {json.dumps(preview[:3], ensure_ascii=False, default=str)}"
            )
    schema_text = "\n".join(schema_parts)

    system = (
        "You are a data analyst assistant. The user has a Snowflake data warehouse. "
        "You are given the table schemas below. "
        "Answer the user's question by writing a SQL query (Snowflake SQL dialect). "
        "Return ONLY valid JSON with keys: "
        '"answer" (string — brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"sqlQuery" (string — a SELECT query, or null). '
        "IMPORTANT: Use fully qualified table names: \"DATABASE\".\"SCHEMA\".\"TABLE\". "
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
    messages.append(
        {"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"}
    )

    raw_answer, usage, trace = await chat_completion(
        messages, max_tokens=2048, llm_overrides=llm_overrides
    )
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "snowflake"
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
            rows = await loop.run_in_executor(
                None,
                lambda: _run_query_sync(
                    account, user, password, warehouse, database, schema, sql_query
                ),
            )
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
            answer = f"{answer}\n\n*Error executing query on Snowflake: {e}*"

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
