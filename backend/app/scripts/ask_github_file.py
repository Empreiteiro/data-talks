"""
Answer questions about data files hosted in a GitHub repository.

Supports CSV, TSV and JSON (array of objects) files.
Downloads the file via the GitHub API, loads into an in-memory SQLite
table and routes to the LLM the same way as ask_csv.
"""
from typing import Any
import io
import json
import math
import re
import sqlite3

import httpx
import pandas as pd


MAX_ROWS = 100_000


async def _download_github_file(
    token: str | None,
    repo: str,
    branch: str,
    file_path: str,
) -> bytes:
    """Download raw file content from a GitHub repository."""
    headers = {"Accept": "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # Use raw content endpoint
    url = f"https://raw.githubusercontent.com/{repo}/{branch}/{file_path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code == 401:
        raise ValueError("GitHub authentication failed. Check the token.")
    if resp.status_code == 404:
        raise ValueError(f"File '{file_path}' not found in {repo}@{branch}.")
    if resp.status_code != 200:
        raise ValueError(f"GitHub error {resp.status_code}: {resp.text[:200]}")
    return resp.content


def _parse_file_content(content: bytes, file_path: str) -> pd.DataFrame:
    """Parse raw bytes into a DataFrame based on file extension."""
    ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
    if ext in ("csv",):
        return pd.read_csv(io.BytesIO(content), nrows=MAX_ROWS)
    if ext in ("tsv",):
        return pd.read_csv(io.BytesIO(content), sep="\t", nrows=MAX_ROWS)
    if ext in ("json", "jsonl", "ndjson"):
        text = content.decode("utf-8")
        # Try newline-delimited JSON first
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if len(lines) > 1:
            try:
                rows = [json.loads(l) for l in lines]
                return pd.DataFrame(rows).head(MAX_ROWS)
            except json.JSONDecodeError:
                pass
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return pd.DataFrame(parsed).head(MAX_ROWS)
        if isinstance(parsed, dict):
            # Try to find a list value
            for v in parsed.values():
                if isinstance(v, list):
                    return pd.DataFrame(v).head(MAX_ROWS)
            return pd.DataFrame([parsed])
        raise ValueError("JSON file must be an array of objects or newline-delimited JSON.")
    raise ValueError(f"Unsupported file extension '.{ext}'. Supported: csv, tsv, json, jsonl.")


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _build_sample_profile(df: pd.DataFrame) -> dict:
    profile: dict = {"sample_rows": len(df), "columns": {}}
    if len(df) == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile: dict = {"type": str(series.dtype), "missing": int(series.isna().sum())}
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
        if numeric := info.get("numeric"):
            line += f", numeric={numeric}"
        if top := info.get("top_values"):
            line += f", top_values={top}"
        lines.append(line)
    return "\n".join(lines)


def _run_sql_on_conn(conn: sqlite3.Connection, query: str) -> list[dict] | None:
    q = query.strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE", "CREATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")
    cur = conn.execute(query)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


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
                return _coerce(json.loads(raw_clean[start : end + 1]), True)
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


async def ask_github_file(
    github_repo: str,
    file_path: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    github_token: str | None = None,
    github_branch: str = "main",
    columns: list[str] | None = None,
    preview_rows: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Download a data file from GitHub, load into in-memory SQLite, and answer
    the question with the LLM — identical flow to ask_csv.
    """
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log
    from app.scripts.sql_utils import extract_sql_from_field

    content = await _download_github_file(
        token=github_token,
        repo=github_repo,
        branch=github_branch or "main",
        file_path=file_path,
    )
    df = _parse_file_content(content, file_path)
    columns = list(df.columns)
    full_row_count = len(df)
    preview = df.head(10).to_dict(orient="records")
    sample_profile = _build_sample_profile(df.head(1000))
    profile_text = _format_profile(sample_profile)
    sample_json = str(preview[:5])

    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)}. "
        "Use SELECT ... FROM data. Quote column names with double quotes if they have spaces or special chars."
    )

    system = (
        "You are an assistant that answers questions about tabular data from a GitHub repository file. "
        "The full dataset is loaded in a table named 'data'. "
        "For questions requiring precise filtering, counting, or aggregation, you MUST provide a SQL query in sqlQuery. "
        "Use standard SQL: SELECT ... FROM data. Quote column names with double quotes if they have spaces or special chars. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). The sqlQuery will be executed on the full data for accurate results. "
        "Any suggested follow-up questions must be answerable using only the available columns in the schema. "
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

    messages: list[dict] = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "github_file"
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
        if sql_query and sql_query.upper().strip().startswith("SELECT"):
            try:
                rows = _run_sql_on_conn(conn, sql_query)
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
