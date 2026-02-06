"""
Answer questions about an SQL database using an LLM (generates/executes SQL when safe).
Replaces ask-question-sql without Langflow.
"""
from typing import Any


async def ask_sql(
    connection_string: str,
    question: str,
    agent_description: str = "",
    table_infos: list[dict] | None = None,
) -> dict[str, Any]:
    """
    connection_string: database URL (e.g. postgresql://...).
    table_infos: [{ "table": "x", "columns": [...] }] for LLM context.
    """
    from app.llm.client import chat_completion

    schema_text = ""
    if table_infos:
        for t in table_infos:
            schema_text += f"Table {t.get('table', '')}: columns {t.get('columns', [])}\n"

    system = (
        "You are an assistant that answers questions about an SQL database. "
        "You may suggest SQL queries when safe (SELECT only)."
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
