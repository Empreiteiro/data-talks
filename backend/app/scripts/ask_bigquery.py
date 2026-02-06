"""
Answer questions about BigQuery using an LLM.
Replaces ask-question-bigquery without Langflow.
Requires google-cloud-bigquery and credentials.
"""
from typing import Any


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
        "You may suggest SQL queries (SELECT only) when appropriate."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Schema: {schema_text}\n\nQuestion: {question}"},
    ]
    answer = await chat_completion(messages, max_tokens=2048)
    follow_up = [line.strip() for line in answer.split("\n") if line.strip().endswith("?") and len(line.strip()) > 15][:3]
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up}
