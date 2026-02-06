"""
Answer questions about Google Sheets using an LLM.
Requires Google service account credentials in an environment variable.
Replaces ask-question-google-sheets (no Langflow).
"""
from typing import Any
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
        "Use only the context provided."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Context: {schema_text}\nSample: {sample_json}\n\nQuestion: {question}"},
    ]
    answer = await chat_completion(messages, max_tokens=2048)
    follow_up = [line.strip() for line in answer.split("\n") if line.strip().endswith("?") and len(line.strip()) > 15][:3]
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up}
