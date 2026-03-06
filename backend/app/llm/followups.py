from typing import Any
import json
import re

from app.llm.client import chat_completion


def _clean_followups(questions: list[str] | None, limit: int = 3) -> list[str]:
    if not questions:
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for q in questions:
        if not isinstance(q, str):
            continue
        item = re.sub(r"\s+", " ", q).strip()
        if not item:
            continue
        if not item.endswith("?"):
            item += "?"
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)
        if len(cleaned) >= limit:
            break
    return cleaned


def _parse_followups_json(raw: str) -> list[str]:
    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        data = json.loads(raw_clean)
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return []
        try:
            data = json.loads(raw_clean[start : end + 1])
        except json.JSONDecodeError:
            return []
    if not isinstance(data, dict):
        return []
    return _clean_followups(data.get("followUpQuestions") or [])


async def refine_followup_questions(
    question: str,
    candidate_questions: list[str] | None,
    schema_text: str,
    llm_overrides: dict[str, Any] | None = None,
) -> list[str]:
    candidates = _clean_followups(candidate_questions)
    if not candidates:
        return []
    if not schema_text.strip():
        return candidates

    system = (
        "You validate and rewrite suggested follow-up questions for tabular data. "
        "Return ONLY questions that can be answered using the schema provided. "
        "Use only the available tables and columns explicitly listed in the schema. "
        "Do not invent fields, metrics, dimensions, joins, or business concepts that are not grounded in the schema. "
        "If a candidate is not answerable, rewrite it into the closest answerable question using the available schema. "
        "Keep at most 3 concise follow-up questions. "
        "Return ONLY valid JSON with one key: followUpQuestions (array of strings)."
    )
    user = (
        f"Original user question: {question}\n\n"
        f"Available schema:\n{schema_text}\n\n"
        f"Candidate follow-up questions:\n{json.dumps(candidates, ensure_ascii=False)}\n\n"
        "Validate and rewrite the follow-up questions now."
    )
    raw, _, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=300,
        llm_overrides=llm_overrides,
    )
    parsed = _parse_followups_json(raw)
    return parsed or candidates[:3]
