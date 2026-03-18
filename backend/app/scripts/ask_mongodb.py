"""
MongoDB Q&A: connect to a MongoDB collection, fetch documents,
convert to DataFrames, then use LLM + pandas to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import re


def _get_mongo_client(connection_string: str):
    """Return a pymongo MongoClient for the given connection string."""
    from pymongo import MongoClient

    if not connection_string or not connection_string.strip():
        raise ValueError("MongoDB connection string is required")
    return MongoClient(connection_string, serverSelectionTimeoutMS=10000)


def _test_connection_sync(connection_string: str) -> bool:
    """Test if a MongoDB connection string is valid."""
    client = _get_mongo_client(connection_string)
    try:
        client.admin.command("ping")
        return True
    finally:
        client.close()


def _list_databases_sync(connection_string: str) -> list[str]:
    """List available databases."""
    client = _get_mongo_client(connection_string)
    try:
        return [
            db
            for db in client.list_database_names()
            if db not in ("admin", "config", "local")
        ]
    finally:
        client.close()


def _list_collections_sync(connection_string: str, database: str) -> list[str]:
    """List collections in a database."""
    client = _get_mongo_client(connection_string)
    try:
        db = client[database]
        return db.list_collection_names()
    finally:
        client.close()


def _fetch_documents_sync(
    connection_string: str,
    database: str,
    collection: str,
    limit: int = 10000,
) -> list[dict]:
    """Fetch documents from a MongoDB collection."""
    client = _get_mongo_client(connection_string)
    try:
        db = client[database]
        coll = db[collection]
        docs = list(coll.find({}, limit=limit))
        for doc in docs:
            if "_id" in doc:
                doc["_id"] = str(doc["_id"])
        return docs
    finally:
        client.close()


def _fetch_schema_sync(
    connection_string: str,
    database: str,
    collection: str,
    sample_size: int = 100,
) -> dict:
    """
    Sample documents from a collection to discover fields.
    Returns { "fields": [...], "preview": [...] }.
    """
    client = _get_mongo_client(connection_string)
    try:
        db = client[database]
        coll = db[collection]
        docs = list(coll.find({}, limit=sample_size))
        field_set: set[str] = set()
        preview: list[dict] = []
        for doc in docs:
            if "_id" in doc:
                doc["_id"] = str(doc["_id"])
            field_set.update(doc.keys())
            if len(preview) < 5:
                preview.append({k: _safe_str(v) for k, v in doc.items()})
        return {
            "fields": sorted(field_set),
            "preview": preview,
        }
    finally:
        client.close()


def _safe_str(v: Any) -> str:
    """Convert a value to string safely for preview."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        try:
            return json.dumps(v, default=str, ensure_ascii=False)[:200]
        except Exception:
            return str(v)[:200]
    return str(v)[:200]


def _docs_to_df(docs: list[dict]):
    """Convert a list of MongoDB documents to a pandas DataFrame."""
    import pandas as pd

    if not docs:
        return pd.DataFrame()
    return pd.json_normalize(docs)


def _run_pandas_code(code: str, dataframes: dict) -> Any:
    """
    Execute pandas code in a restricted namespace.
    `dataframes` is a dict of {collection_name: DataFrame}.
    """
    import pandas as pd

    safe_globals = {
        "__builtins__": {
            "len": len, "range": range, "enumerate": enumerate,
            "list": list, "dict": dict, "str": str, "int": int,
            "float": float, "bool": bool, "round": round,
            "sum": sum, "min": min, "max": max, "abs": abs,
            "sorted": sorted, "print": print,
        },
        "pd": pd,
    }
    first = True
    for name, df in dataframes.items():
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
        safe_globals[safe_name] = df
        if first:
            safe_globals["df"] = df
            first = False

    lines = code.strip().split("\n")
    if not lines:
        return None

    try:
        body = "\n".join(lines[:-1])
        last = lines[-1].strip()
        if body:
            exec(body, safe_globals)  # noqa: S102
        result = eval(last, safe_globals)  # noqa: S307
        return result
    except Exception:
        exec(code, safe_globals)  # noqa: S102
        return safe_globals.get("result")


async def ask_mongodb(
    connection_string: str | None,
    database: str,
    collection: str,
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    schema: dict | None = None,
    preview: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Main entry point for MongoDB Q&A.

    connection_string: MongoDB connection URI.
    database: database name.
    collection: collection name.
    schema: cached schema { "fields": [...] }.
    preview: cached preview rows.
    """
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not connection_string:
        raise ValueError("MongoDB connection string is required")

    loop = asyncio.get_event_loop()

    # Get/refresh schema if not cached
    if not schema or not schema.get("fields"):
        schema_data = await loop.run_in_executor(
            None,
            lambda: _fetch_schema_sync(connection_string, database, collection),
        )
        schema = schema_data
        preview = schema_data.get("preview", [])

    # Build schema text for LLM
    schema_parts = [
        f"Database: {database}",
        f"Collection: {collection}",
        f"Fields: {schema.get('fields', [])}",
    ]
    if preview:
        schema_parts.append(
            f"Sample documents (up to 5): {json.dumps(preview[:5], ensure_ascii=False, default=str)}"
        )
    schema_text = "\n".join(schema_parts)

    system = (
        "You are a data analyst assistant. The user has a MongoDB database. "
        "You are given the collection schema (field names) below. "
        "Answer the question by writing a short pandas Python code snippet that analyses the data. "
        "The DataFrame is pre-loaded as variable `df` (the collection data, flattened). "
        "Return ONLY valid JSON with keys: "
        '"answer" (string — a brief natural language answer), '
        '"followUpQuestions" (array of up to 3 strings), '
        '"pandasCode" (string — Python/pandas code to compute the answer, or null if not needed). '
        "Any suggested follow-up questions must be answerable using only the available fields. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append(
        {"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"}
    )

    raw_answer, usage, trace = await chat_completion(
        messages, max_tokens=2048, llm_overrides=llm_overrides
    )
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "mongodb"
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
    pandas_code = (parsed.get("pandasCode") or "").strip()

    chart_input = None
    if pandas_code:
        try:
            docs = await loop.run_in_executor(
                None,
                lambda: _fetch_documents_sync(connection_string, database, collection),
            )
            dataframes = {collection: _docs_to_df(docs)}
            result_value = _run_pandas_code(pandas_code, dataframes)
            rows = _result_to_rows(result_value)

            if rows is not None:
                chart_input = build_chart_input(rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=rows,
                    agent_description=agent_description,
                    source_name=source_name,
                    schema_text=schema_text,
                    llm_overrides=llm_overrides,
                    channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
        except Exception as e:
            answer = f"{answer}\n\n*Error executing code on MongoDB: {e}*"

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
        channel=channel,
    )
    return {
        "answer": answer,
        "imageUrl": None,
        "followUpQuestions": follow_up,
        "chartInput": chart_input,
    }


def _result_to_rows(value: Any) -> list[dict] | None:
    """Convert a pandas result (DataFrame, Series, scalar) to list of dicts."""
    if value is None:
        return None
    try:
        import pandas as pd

        if isinstance(value, pd.DataFrame):
            return value.head(500).to_dict(orient="records")
        if isinstance(value, pd.Series):
            return value.head(500).reset_index().to_dict(orient="records")
        if isinstance(value, (int, float, str, bool)):
            return [{"value": value}]
        if isinstance(value, (list, dict)):
            return value if isinstance(value, list) else [value]
    except Exception:
        pass
    return None


def _parse_llm_json(raw: str) -> dict[str, Any]:
    def _coerce(data: Any, parsed_ok: bool) -> dict[str, Any]:
        answer = data.get("answer") if isinstance(data, dict) else None
        follow_up = data.get("followUpQuestions") if isinstance(data, dict) else None
        pandas_code = data.get("pandasCode") if isinstance(data, dict) else None
        if not isinstance(answer, str):
            answer = ""
        if not isinstance(follow_up, list):
            follow_up = []
        follow_up = [q for q in follow_up if isinstance(q, str) and q.strip()]
        if not isinstance(pandas_code, str):
            pandas_code = ""
        return {
            "answer": answer,
            "followUpQuestions": follow_up[:3],
            "pandasCode": pandas_code,
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
        cleaned = line.strip().lstrip("-0123456789. ").strip()
        if cleaned.endswith("?") and len(cleaned) > 15:
            follow_up.append(cleaned)
    return list(dict.fromkeys(follow_up))[:3]
