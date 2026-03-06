"""
Answer questions about Google Sheets using an LLM.
Requires Google service account credentials in an environment variable.
Replaces ask-question-google-sheets (no Langflow).
"""
from typing import Any
import json
import os
import re


async def ask_google_sheets(
    spreadsheet_id: str,
    sheet_name: str,
    available_columns: list[str] | None,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    credentials_json: str | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
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
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    # TODO: implement real sheet read (gspread)
    columns_text = ", ".join(available_columns or [])
    schema_text = f"Spreadsheet: {spreadsheet_id}, sheet: {sheet_name}. Columns: {columns_text or 'unknown'}"
    sample_json = "[]"

    system = (
        "You are an assistant that answers questions about Google Sheets data. "
        "Use only the context provided. "
        "If the question requires precise filtering or aggregation on the full sheet, you MUST provide a SQL query "
        "(in a fenced ```sql``` block) that would answer it exactly. "
        "In that case, also state that the answer requires executing the SQL on the full dataset. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Any suggested follow-up questions must be answerable using only the available columns in the schema. "
        "Do not invent fields, dimensions, or metrics that are not present in that schema. "
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
    messages.append({"role": "user", "content": f"Context: {schema_text}\nSample: {sample_json}\n\nQuestion: {question}"})
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
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": None}


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
