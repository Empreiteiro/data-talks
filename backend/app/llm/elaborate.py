"""
Second-phase LLM call: receive query results and elaborate a natural answer.
Used by ask_csv, ask_bigquery, ask_sql after executing SQL.
"""
from decimal import Decimal
from typing import Any
import json
import re

from app.llm.client import chat_completion
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log


def _safe_value(v: Any) -> Any:
    """Convert values for display in elaborate prompt."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v) if v.is_finite() else None
    return v


def _format_rows_for_elaborate(rows: list[dict], max_rows: int = 50) -> str:
    """Format rows for the elaborate prompt."""
    if not rows:
        return "0 rows returned."
    lines = []
    for i, row in enumerate(rows[:max_rows], 1):
        parts = [f"{k}: {_safe_value(v)}" for k, v in row.items()]
        lines.append(f"  {i}. " + ", ".join(parts))
    suffix = f"\n  ... and {len(rows) - max_rows} more rows" if len(rows) > max_rows else ""
    return "\n".join(lines) + suffix


async def elaborate_answer_with_results(
    question: str,
    query_results: list[dict],
    agent_description: str = "",
    source_name: str | None = None,
    schema_text: str = "",
    llm_overrides: dict | None = None,
) -> dict[str, Any]:
    """
    Second LLM call: given the question and query results, craft an elaborated
    natural-language answer. Returns {answer, followUpQuestions}.
    """
    if not query_results:
        results_text = "0 rows returned."
    else:
        results_text = _format_rows_for_elaborate(query_results)

    system = (
        "You are a data analyst assistant. The user asked a question about their data. "
        "You received the results from a SQL query run on the full dataset. "
        "Your task is to write a clear, natural, elaborated answer based on the question and these results. "
        "Do NOT just dump the raw data. Interpret it, summarize it, and present it in a helpful way. "
        "If it's a list of items, present it as a readable list. "
        "If it's a count or aggregate, explain what it means. "
        "Keep the answer concise but informative. "
        "Suggested follow-up questions must be answerable using only the available schema. "
        "Do not mention columns, metrics, or concepts that are not grounded in that schema. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of 0-3 suggested follow-up questions as strings). "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"User question: {question}\n\n"
        f"Available schema:\n{schema_text or 'Not provided'}\n\n"
        f"Query results:\n{results_text}\n\n"
        "Write an elaborated answer based on the question and these results."
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    raw, usage, trace = await chat_completion(
        messages, max_tokens=1024, llm_overrides=llm_overrides
    )
    await record_log(
        action="elaborate",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        trace=trace,
    )

    parsed = _parse_elaborate_json(raw)
    follow_ups = await refine_followup_questions(
        question=question,
        candidate_questions=parsed.get("followUpQuestions") or [],
        schema_text=schema_text,
        llm_overrides=llm_overrides,
    )
    return {
        "answer": parsed.get("answer") or raw,
        "followUpQuestions": follow_ups,
    }


def _parse_elaborate_json(raw: str) -> dict[str, Any]:
    """Parse elaborate response JSON."""
    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        data = json.loads(raw_clean)
        if not isinstance(data, dict):
            return {}
        answer = data.get("answer") or ""
        follow_up = data.get("followUpQuestions") or []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()][:3]
        return {"answer": answer, "followUpQuestions": follow_up}
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(raw_clean[start : end + 1])
                follow_up = [q for q in (data.get("followUpQuestions") or []) if isinstance(q, str) and q.strip()][:3]
                return {"answer": data.get("answer") or raw, "followUpQuestions": follow_up}
            except json.JSONDecodeError:
                pass
    return {"answer": raw, "followUpQuestions": []}
