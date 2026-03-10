"""
Answer questions about CSV/XLSX data using an LLM (OpenAI or Ollama).
Generates and executes SQL on the full dataset for accurate answers.
"""
from pathlib import Path
from typing import Any
import re
import json
import math
import sqlite3
import pandas as pd
from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field

# Max rows to load into SQLite (memory safety)
MAX_CSV_ROWS = 100_000


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
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    file_path: path relative to data_files (e.g. user_id/timestamp.csv).
    question: natural language question.
    Returns: { "answer", "imageUrl" (optional), "followUpQuestions" }.
    """
    full_path = Path(data_files_dir) / file_path
    if not full_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Load full file for SQL execution (CSV or XLSX)
    df_full = _load_full_dataframe(full_path)
    columns = list(df_full.columns)
    full_row_count = len(df_full)
    preview = df_full.head(10).to_dict(orient="records")
    schema_text = _format_schema(columns, preview)
    sample_json = str(preview[:5])
    sample_profile = _build_sample_profile(df_full.head(1000))
    profile_text = _format_profile(sample_profile)

    # Create in-memory SQLite with table "data" for SQL execution
    conn = sqlite3.connect(":memory:")
    df_full.to_sql("data", conn, index=False, if_exists="replace")

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)}. "
        "Use SELECT ... FROM data. Quote column names with double quotes if they have spaces or special chars (e.g. \"Release Year\")."
    )

    system = (
        "You are an assistant that answers questions about tabular data (CSV/spreadsheet). "
        "The full dataset is loaded in a table named 'data'. "
        "For questions requiring precise filtering, counting, or aggregation, you MUST provide a SQL query in sqlQuery. "
        "Use standard SQL: SELECT ... FROM data. Quote column names with double quotes if they have spaces or special chars. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). The sqlQuery will be executed on the full data for accurate results. "
        "Any suggested follow-up questions must be answerable using only the available columns in the schema. "
        "Do not invent fields, dimensions, or metrics that are not grounded in those columns. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"{schema_for_sql}\n\n"
        f"Total rows: {full_row_count}\n"
        f"Sample profile:\n{profile_text}\n\n"
        f"Sample data (up to 5 rows):\n{sample_json}\n\n"
        f"User question: {question}"
    )

    messages = [
        {"role": "system", "content": system},
    ]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})
    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "csv"
    await record_log(
        action="pergunta",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace,
    )
    parsed = _parse_llm_json(raw_answer)
    answer = parsed["answer"]
    follow_up = parsed["followUpQuestions"]
    sql_query = extract_sql_from_field(parsed.get("sqlQuery") or "")

    chart_input = None
    try:
        # Execute SQL and have LLM elaborate answer from results
        if sql_query and sql_query.upper().strip().startswith("SELECT"):
            try:
                rows = _run_sql_on_csv(conn, sql_query)
                if rows is not None:
                    chart_input = build_chart_input(rows, schema_for_sql)
                    elaborated = await elaborate_answer_with_results(
                        question=question,
                        query_results=rows,
                        agent_description=agent_description,
                        source_name=source_name,
                        schema_text=schema_for_sql,
                        llm_overrides=llm_overrides,
                        channel=channel,
                    )
                    answer = elaborated["answer"]
                    follow_up = elaborated["followUpQuestions"] or follow_up
            except Exception as e:
                answer = f"{answer}\n\n*Erro ao executar a consulta SQL: {e}*"
    finally:
        conn.close()

    if not parsed["parsed_ok"]:
        if not answer:
            answer = raw_answer
        if not follow_up:
            follow_up = _extract_followups(raw_answer)

    follow_up = await refine_followup_questions(
        question=question,
        candidate_questions=follow_up,
        schema_text=schema_for_sql,
        llm_overrides=llm_overrides,
        channel=channel,
    )

    return {
        "answer": answer,
        "imageUrl": None,
        "followUpQuestions": follow_up,
        "chartInput": chart_input,
    }


def _load_full_dataframe(full_path: Path) -> pd.DataFrame:
    """Load full CSV or XLSX into a DataFrame (up to MAX_CSV_ROWS)."""
    ext = full_path.suffix.lower()
    if ext == ".csv":
        return pd.read_csv(full_path, nrows=MAX_CSV_ROWS)
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(full_path, nrows=MAX_CSV_ROWS)
    raise ValueError(f"Unsupported file type: {ext}")


def _run_sql_on_csv(conn: sqlite3.Connection, query: str) -> list[dict] | None:
    """Execute SELECT-only query on SQLite. Returns list of dicts or None."""
    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE", "CREATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")
    cur = conn.execute(query)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _format_rows(rows: list[dict]) -> str:
    """Format rows for display in the answer."""
    if not rows:
        return ""
    lines = []
    for i, row in enumerate(rows, 1):
        parts = [f"{k}: {v}" for k, v in row.items()]
        lines.append(f"  {i}. " + ", ".join(parts))
    return "\n".join(lines)


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
