from typing import Any
import asyncio
import json
import re


def _get_bigquery_client(credentials_content: str | None):
    """Build BigQuery client from service account JSON string."""
    from google.cloud import bigquery
    from google.oauth2 import service_account

    if not credentials_content or not credentials_content.strip():
        raise ValueError("BigQuery credentials_content is required")
    creds_dict = json.loads(credentials_content)
    credentials = service_account.Credentials.from_service_account_info(creds_dict)
    return bigquery.Client(credentials=credentials, project=creds_dict.get("project_id"))


def _fetch_table_infos_sync(client, project_id: str, dataset_id: str, tables: list[str]) -> list[dict]:
    """
    Fetch schema (column names) for each table. If tables is empty, list all tables in dataset.
    Returns [{ "table": "name", "columns": ["col1", "col2", ...] }, ...].
    """
    from google.cloud import bigquery

    dataset_ref = f"{project_id}.{dataset_id}"
    table_list = tables
    if not table_list:
        # List all tables in the dataset
        dataset = client.get_dataset(dataset_ref)
        table_list = [t.table_id for t in client.list_tables(dataset)]

    result = []
    for table_name in table_list:
        try:
            table_ref = f"{dataset_ref}.{table_name}"
            table = client.get_table(table_ref)
            columns = [f.name for f in table.schema]
            result.append({"table": table_name, "columns": columns})
        except Exception as e:
            result.append({"table": table_name, "columns": [], "_error": str(e)})
    return result


def _run_query_sync(client, query: str) -> list[dict]:
    """Run a read-only BigQuery query and return rows as list of dicts."""
    from google.cloud import bigquery

    # Security: only allow SELECT
    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    if "DELETE" in q or "UPDATE" in q or "INSERT" in q or "DROP" in q or "ALTER" in q or "TRUNCATE" in q:
        raise ValueError("Only SELECT queries are allowed")

    job = client.query(query)
    rows = job.result()
    return [dict(row) for row in rows]


async def ask_bigquery(
    credentials_content: str | None,
    project_id: str,
    dataset_id: str,
    tables: list[str],
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
) -> dict[str, Any]:
    """
    credentials_content: Google service account JSON string.
    table_infos: [{ "table": "x", "columns": [...] }] for context. Fetched from BigQuery if missing.
    """
    from app.llm.client import chat_completion
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log
    from app.scripts.sql_utils import extract_sql_from_field

    loop = asyncio.get_event_loop()

    # Get BigQuery client and schema
    client = await loop.run_in_executor(None, lambda: _get_bigquery_client(credentials_content))

    # Normalize table_infos: support both "table" and "table_name", "columns" only
    if table_infos:
        table_infos = [
            {"table": t.get("table") or t.get("table_name", ""), "columns": t.get("columns") or []}
            for t in table_infos
        ]
    if not table_infos or not any(t.get("columns") for t in table_infos):
        table_infos = await loop.run_in_executor(
            None, lambda: _fetch_table_infos_sync(client, project_id, dataset_id, tables)
        )

    schema_text = f"Project: {project_id}, Dataset: {dataset_id}, Tables: {[t.get('table') for t in table_infos]}"
    for t in table_infos:
        schema_text += f"\nTable {t.get('table', '')}: columns {t.get('columns', [])}"

    system = (
        "You are an assistant that answers questions about Google BigQuery data. "
        "You have the exact table and column names above. "
        "For questions about row count, structure, or data, you MUST provide a SQL query "
        "(SELECT only) in the sqlQuery field. "
        "Use standard SQL and full table names: `project_id.dataset_id.table_id`. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Any suggested follow-up questions must be answerable using only the available tables and columns in the schema. "
        "Do not invent fields, dimensions, joins, or metrics that are not present in that schema. "
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
    messages.append({"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"})
    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    await record_log(
        action="pergunta",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        trace=trace,
    )
    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_query = extract_sql_from_field(parsed.get("sqlQuery") or "")

    # Execute SELECT and have LLM elaborate answer from results
    if sql_query and sql_query.upper().startswith("SELECT"):
        try:
            rows = await loop.run_in_executor(None, lambda: _run_query_sync(client, sql_query))
            if rows is not None:
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=rows,
                    agent_description=agent_description,
                    source_name=source_name,
                    schema_text=schema_text,
                    llm_overrides=llm_overrides,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Erro ao executar a consulta no BigQuery: {e}*"

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
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up}


def _format_rows(rows: list[dict]) -> str:
    """Format a few rows for display in the answer."""
    if not rows:
        return ""
    lines = []
    for i, row in enumerate(rows, 1):
        parts = [f"{k}: {v}" for k, v in row.items()]
        lines.append(f"  {i}. " + ", ".join(parts))
    return "\n".join(lines)


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
        cleaned = line.strip().replace("^[0-9]+\\.\\s*", "").replace("^-\\s*", "").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
