"""
Answer questions about CSV/XLSX data using an LLM (OpenAI or Ollama).
Replaces the ask-question-csv edge function and Langflow flow.
"""
from pathlib import Path
from typing import Any
import re
import json
import math
import pandas as pd
from app.llm.client import chat_completion
from app.llm.logs import record_log


async def ask_csv(
    file_path: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    columns: list[str] | None = None,
    preview_rows: list[dict] | None = None,
    sample_profile: dict | None = None,
    sample_row_count: int | None = None,
    data_files_dir: str = "./data_files",
    llm_overrides: dict | None = None,
) -> dict[str, Any]:
    """
    file_path: path relative to data_files (e.g. user_id/timestamp.csv).
    question: natural language question.
    Returns: { "answer", "imageUrl" (optional), "followUpQuestions" }.
    """
    full_path = Path(data_files_dir) / file_path
    if not full_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Use provided columns/preview from source metadata if available; otherwise read file
    if columns and preview_rows is not None:
        schema_text = _format_schema(columns, preview_rows)
        sample_json = str(preview_rows[:5])
    else:
        df = pd.read_csv(full_path, nrows=200)
        columns = list(df.columns)
        preview = df.head(10).to_dict(orient="records")
        schema_text = _format_schema(columns, preview)
        sample_json = str(preview[:5])
        sample_profile = _build_sample_profile(df)
        sample_row_count = len(df)

    profile_text = _format_profile(sample_profile)
    sample_rows_text = f"Sample size: {sample_row_count} rows (partial sample, not full dataset)."

    system = (
        "You are an assistant that answers questions about tabular data (CSV/spreadsheet). "
        "Answer clearly and concisely. Use only the columns, sample data, and sample profile provided. "
        "Do not assume you have access to the full dataset. "
        "If the question requires precise filtering or aggregation on the full dataset, you MUST provide a SQL query "
        "(in a fenced ```sql``` block) that would answer it exactly. "
        "In that case, also state that the answer requires executing the SQL on the full dataset. "
        "If an exact answer is not possible from the sample, provide an approximate answer based on the sample. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"Schema and columns: {schema_text}\n\n"
        f"{sample_rows_text}\n"
        f"Sample profile:\n{profile_text}\n\n"
        f"Sample data (up to 5 rows):\n{sample_json}\n\n"
        f"User question: {question}"
    )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    raw_answer, usage = await chat_completion(messages, max_tokens=1024, llm_overrides=llm_overrides)
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

    return {
        "answer": answer,
        "imageUrl": None,  # Optional: add chart generation (matplotlib/plotly → base64)
        "followUpQuestions": follow_up,
    }


def _format_schema(columns: list[str], preview_rows: list[dict]) -> str:
    return "Columns: " + ", ".join(columns)


def _safe_float(value: float | int | None) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _build_sample_profile(df: pd.DataFrame) -> dict:
    sample_rows = len(df)
    profile = {
        "sample_rows": sample_rows,
        "columns": {},
    }
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile = {
            "type": str(series.dtype),
            "missing": int(series.isna().sum()),
        }
        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                col_profile["numeric"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                    "median": _safe_float(numeric.median()),
                }
        else:
            counts = series.dropna().astype(str).value_counts().head(3)
            if not counts.empty:
                col_profile["top_values"] = counts.to_dict()
        profile["columns"][str(col)] = col_profile
    return profile


def _format_profile(sample_profile: dict | None, max_columns: int = 30) -> str:
    if not sample_profile:
        return "No sample profile available."
    columns = sample_profile.get("columns", {})
    lines = []
    for i, (col, info) in enumerate(columns.items()):
        if i >= max_columns:
            remaining = max(len(columns) - max_columns, 0)
            if remaining:
                lines.append(f"... and {remaining} more columns not shown.")
            break
        col_type = info.get("type", "unknown")
        missing = info.get("missing", 0)
        line = f"- {col} (type={col_type}, missing={missing})"
        numeric = info.get("numeric")
        top_values = info.get("top_values")
        if numeric:
            line += f", numeric={numeric}"
        if top_values:
            line += f", top_values={top_values}"
        lines.append(line)
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
