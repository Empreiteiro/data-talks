"""
Answer questions about an SQL database using an LLM (generates/executes SQL when safe).
Replaces ask-question-sql without Langflow.
"""
from typing import Any
import json
import re


async def ask_sql(
    connection_string: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    table_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
) -> dict[str, Any]:
    """
    connection_string: database URL (e.g. postgresql://...).
    table_infos: [{ "table": "x", "columns": [...] }] for LLM context.
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log

    schema_text = ""
    if table_infos:
        for t in table_infos:
            schema_text += f"Table {t.get('table', '')}: columns {t.get('columns', [])}\n"

    system = (
        "You are an assistant that answers questions about an SQL database. "
        "When the question requires precise filtering or aggregation, you MUST provide a SQL query "
        "(SELECT only, in a fenced ```sql``` block). "
        "Then explain the expected result briefly. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Schema: {schema_text}\n\nQuestion: {question}"},
    ]
    raw_answer, usage = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    await record_log(
        action="pergunta",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
    )
    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    if not parsed["parsed_ok"]:
        if not answer:
            answer = raw_answer
        if not follow_up:
            follow_up = _extract_followups(raw_answer)
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up}


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
