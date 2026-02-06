"""
Answer questions about BigQuery using an LLM.
Replaces ask-question-bigquery without Langflow.
Requires google-cloud-bigquery and credentials.
"""
from typing import Any
import json


async def ask_bigquery(
    credentials_content: str | None,
    project_id: str,
    dataset_id: str,
    tables: list[str],
    question: str,
    agent_description: str = "",
    table_infos: list[dict] | None = None,
) -> dict[str, Any]:
    """
    credentials_content: Google service account JSON string.
    table_infos: [{ "table": "x", "columns": [...] }] for context.
    """
    from app.llm.client import chat_completion

    schema_text = f"Project: {project_id}, Dataset: {dataset_id}, Tables: {tables}"
    if table_infos:
        for t in table_infos:
            schema_text += f"\nTable {t.get('table', '')}: {t.get('columns', [])}"

    system = (
        "You are an assistant that answers questions about Google BigQuery data. "
        "When the question requires precise filtering or aggregation, you MUST provide a SQL query "
        "(SELECT only, in a fenced ```sql``` block). "
        "Then explain the expected result briefly. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings). "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Schema: {schema_text}\n\nQuestion: {question}"},
    ]
    raw_answer = await chat_completion(messages, max_tokens=2048)
    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"] or raw_answer
    follow_up = parsed["followUpQuestions"]
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        return {"answer": answer, "followUpQuestions": follow_up[:3]}
    except json.JSONDecodeError:
        return {"answer": "", "followUpQuestions": []}
