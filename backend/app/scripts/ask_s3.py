"""
Amazon S3 / MinIO Q&A: download a file from S3, parse with pandas,
then reuse ask_csv logic (SQL on in-memory SQLite) for Q&A.
"""
from typing import Any
import asyncio
import json
import math
import re
import sqlite3
import tempfile
from pathlib import Path

import pandas as pd

from app.llm.client import chat_completion
from app.llm.charting import build_chart_input
from app.llm.elaborate import elaborate_answer_with_results
from app.llm.followups import refine_followup_questions
from app.llm.logs import record_log
from app.scripts.sql_utils import extract_sql_from_field

MAX_S3_ROWS = 100_000


def _get_s3_client(
    access_key_id: str,
    secret_access_key: str,
    region: str = "us-east-1",
    endpoint: str | None = None,
):
    """Return a boto3 S3 client."""
    import boto3

    kwargs: dict[str, Any] = {
        "aws_access_key_id": access_key_id,
        "aws_secret_access_key": secret_access_key,
        "region_name": region,
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


def _test_connection_sync(
    access_key_id: str,
    secret_access_key: str,
    region: str = "us-east-1",
    endpoint: str | None = None,
) -> bool:
    """Test S3 credentials by listing buckets."""
    client = _get_s3_client(access_key_id, secret_access_key, region, endpoint)
    client.list_buckets()
    return True


def _list_buckets_sync(
    access_key_id: str,
    secret_access_key: str,
    region: str = "us-east-1",
    endpoint: str | None = None,
) -> list[str]:
    """List accessible S3 buckets."""
    client = _get_s3_client(access_key_id, secret_access_key, region, endpoint)
    resp = client.list_buckets()
    return [b["Name"] for b in resp.get("Buckets", [])]


def _list_objects_sync(
    access_key_id: str,
    secret_access_key: str,
    region: str,
    endpoint: str | None,
    bucket: str,
    prefix: str = "",
    extensions: tuple[str, ...] = (".csv", ".json", ".jsonl", ".parquet"),
) -> list[dict]:
    """List objects in a bucket, optionally filtered by extension."""
    client = _get_s3_client(access_key_id, secret_access_key, region, endpoint)
    paginator = client.get_paginator("list_objects_v2")
    params: dict = {"Bucket": bucket, "MaxKeys": 1000}
    if prefix:
        params["Prefix"] = prefix

    results = []
    for page in paginator.paginate(**params):
        for obj in page.get("Contents", []):
            key = obj.get("Key", "")
            if extensions and not any(key.lower().endswith(ext) for ext in extensions):
                continue
            results.append({
                "key": key,
                "size": obj.get("Size", 0),
                "lastModified": obj.get("LastModified", "").isoformat() if hasattr(obj.get("LastModified", ""), "isoformat") else str(obj.get("LastModified", "")),
            })
            if len(results) >= 500:
                return results
    return results


def _download_and_parse_sync(
    access_key_id: str,
    secret_access_key: str,
    region: str,
    endpoint: str | None,
    bucket: str,
    key: str,
    file_type: str | None = None,
) -> pd.DataFrame:
    """Download a file from S3 and parse into a DataFrame."""
    client = _get_s3_client(access_key_id, secret_access_key, region, endpoint)

    if not file_type:
        lower_key = key.lower()
        if lower_key.endswith(".csv"):
            file_type = "csv"
        elif lower_key.endswith(".parquet"):
            file_type = "parquet"
        elif lower_key.endswith(".jsonl"):
            file_type = "jsonl"
        elif lower_key.endswith(".json"):
            file_type = "json"
        else:
            file_type = "csv"

    with tempfile.NamedTemporaryFile(suffix=f".{file_type}", delete=False) as tmp:
        client.download_file(bucket, key, tmp.name)
        tmp_path = Path(tmp.name)

    try:
        if file_type == "csv":
            return pd.read_csv(tmp_path, nrows=MAX_S3_ROWS)
        elif file_type == "parquet":
            df = pd.read_parquet(tmp_path)
            return df.head(MAX_S3_ROWS)
        elif file_type == "jsonl":
            return pd.read_json(tmp_path, lines=True, nrows=MAX_S3_ROWS)
        elif file_type == "json":
            data = json.loads(tmp_path.read_text())
            if isinstance(data, list):
                df = pd.json_normalize(data)
            elif isinstance(data, dict):
                # Try common data paths
                for path_key in ("data", "results", "items", "records"):
                    if path_key in data and isinstance(data[path_key], list):
                        df = pd.json_normalize(data[path_key])
                        break
                else:
                    df = pd.json_normalize([data])
            else:
                df = pd.DataFrame([{"value": data}])
            return df.head(MAX_S3_ROWS)
        else:
            return pd.read_csv(tmp_path, nrows=MAX_S3_ROWS)
    finally:
        tmp_path.unlink(missing_ok=True)


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _build_sample_profile(df: pd.DataFrame) -> dict:
    sample_rows = len(df)
    profile = {"sample_rows": sample_rows, "columns": {}}
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile = {"type": str(series.dtype), "missing": int(series.isna().sum())}
        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                col_profile["numeric"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                }
        profile["columns"][str(col)] = col_profile
    return profile


async def ask_s3(
    access_key_id: str,
    secret_access_key: str,
    region: str,
    endpoint: str | None,
    bucket: str,
    key: str,
    file_type: str | None = None,
    question: str = "",
    agent_description: str = "",
    source_name: str | None = None,
    columns: list[str] | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """Main entry point for S3/MinIO Q&A."""
    loop = asyncio.get_event_loop()

    df = await loop.run_in_executor(
        None,
        lambda: _download_and_parse_sync(
            access_key_id, secret_access_key, region, endpoint, bucket, key, file_type
        ),
    )

    columns = list(df.columns)
    full_row_count = len(df)
    preview = df.head(10).to_dict(orient="records")
    sample_profile = _build_sample_profile(df.head(1000))

    conn = sqlite3.connect(":memory:")
    df.to_sql("data", conn, index=False, if_exists="replace")

    schema_for_sql = (
        f"Table 'data' with columns: {', '.join(columns)}. "
        'Use SELECT ... FROM data. Quote column names with double quotes if they have spaces.'
    )

    profile_lines = []
    for col, info in sample_profile.get("columns", {}).items():
        line = f"- {col} (type={info.get('type', '?')}, missing={info.get('missing', 0)})"
        if info.get("numeric"):
            line += f", numeric={info['numeric']}"
        profile_lines.append(line)
    profile_text = "\n".join(profile_lines)

    system = (
        "You are an assistant that answers questions about tabular data from S3. "
        "The full dataset is loaded in a table named 'data'. "
        "For questions requiring precise filtering, counting, or aggregation, provide a SQL query in sqlQuery. "
        "Use standard SQL: SELECT ... FROM data. Quote column names with double quotes if needed. "
        "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
        "sqlQuery (string or null). Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nAgent context: {agent_description}"

    user_content = (
        f"{schema_for_sql}\n\n"
        f"File: s3://{bucket}/{key}\n"
        f"Total rows: {full_row_count}\n"
        f"Sample profile:\n{profile_text}\n\n"
        f"Sample data (up to 5 rows):\n{json.dumps(preview[:5], default=str, ensure_ascii=False)}\n\n"
        f"User question: {question}"
    )

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": user_content})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "s3"
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
                cur = conn.execute(sql_query)
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, row)) for row in cur.fetchall()]
                if rows:
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
                answer = f"{answer}\n\n*Error executing SQL: {e}*"
    finally:
        conn.close()

    if not parsed["parsed_ok"]:
        if not answer:
            answer = raw_answer

    follow_up = await refine_followup_questions(
        question=question,
        candidate_questions=follow_up,
        schema_text=schema_for_sql,
        llm_overrides=llm_overrides,
        channel=channel,
    )
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data, parsed_ok):
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        sql_query = data.get("sqlQuery") if isinstance(data, dict) else None
        if not isinstance(answer, str): answer = ""
        if not isinstance(follow_up, list): follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(sql_query, str): sql_query = ""
        return {"answer": answer, "followUpQuestions": follow_up[:3], "sqlQuery": sql_query, "parsed_ok": parsed_ok}

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
