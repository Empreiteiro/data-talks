"""
Answer questions about Google Sheets using an LLM.
Requires Google service account credentials in an environment variable.
Replaces ask-question-google-sheets (no Langflow).
"""
from typing import Any
import json
import os


async def ask_google_sheets(
    spreadsheet_id: str,
    sheet_name: str,
    question: str,
    agent_description: str = "",
    credentials_json: str | None = None,
) -> dict[str, Any]:
    """
    Fetch sheet data (via Google API), send context to LLM, return answer.
    credentials_json: service account JSON string or None to use GOOGLE_SHEETS_SERVICE_ACCOUNT.
    """
    credentials_json = credentials_json or os.environ.get("GOOGLE_SHEETS_SERVICE_ACCOUNT")
    if not credentials_json:
        raise ValueError("GOOGLE_SHEETS_SERVICE_ACCOUNT not configured")

    # Use gspread + google-auth here to read the sheet when implementing
    from app.llm.client import chat_completion

    # TODO: implement real sheet read (gspread)
    schema_text = f"Spreadsheet: {spreadsheet_id}, sheet: {sheet_name}"
    sample_json = "[]"

    system = (
        "You are an assistant that answers questions about Google Sheets data. "
        "Use only the context provided. "
        "If the question requires precise filtering or aggregation on the full sheet, you MUST provide a SQL query "
        "(in a fenced ```sql``` block) that would answer it exactly. "
        "In that case, also state that the answer requires executing the SQL on the full dataset. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings). "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Context: {schema_text}\nSample: {sample_json}\n\nQuestion: {question}"},
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
