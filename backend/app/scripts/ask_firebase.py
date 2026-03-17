"""
Firestore Q&A: fetch documents from selected collections, convert to DataFrames,
then use LLM + pandas to answer natural language questions.
"""
from typing import Any
import asyncio
import json
import re


# Firebase app registry to avoid re-initializing the same credentials
_firebase_apps: dict[str, Any] = {}


def _get_firebase_app(credentials_content: str):
    """Return a named firebase_admin App for the given service account JSON."""
    import firebase_admin
    from firebase_admin import credentials as fb_credentials

    if not credentials_content or not credentials_content.strip():
        raise ValueError("Firebase credentials_content is required")

    creds_dict = json.loads(credentials_content)
    project_id = creds_dict.get("project_id", "")
    app_name = f"datatalk_{project_id}"

    if app_name in _firebase_apps:
        try:
            return firebase_admin.get_app(app_name)
        except Exception:
            pass

    cred = fb_credentials.Certificate(creds_dict)
    app = firebase_admin.initialize_app(cred, name=app_name)
    _firebase_apps[app_name] = app
    return app


def _fetch_collection_docs_sync(credentials_content: str, collection_name: str, limit: int = 10000) -> list[dict]:
    """Fetch documents from a Firestore collection. Returns flat list of dicts."""
    from firebase_admin import firestore

    app = _get_firebase_app(credentials_content)
    db = firestore.client(app=app)
    docs = db.collection(collection_name).limit(limit).stream()
    result = []
    for doc in docs:
        row = doc.to_dict() or {}
        row["_id"] = doc.id
        result.append(row)
    return result


def _fetch_collection_infos_sync(credentials_content: str, collections: list[str], sample_size: int = 50) -> list[dict]:
    """
    For each collection, sample `sample_size` documents to discover fields.
    Returns [{ "collection": "name", "fields": [...], "preview_docs": [...] }].
    """
    from firebase_admin import firestore

    app = _get_firebase_app(credentials_content)
    db = firestore.client(app=app)

    result = []
    for collection_name in collections:
        try:
            docs = list(db.collection(collection_name).limit(sample_size).stream())
            field_set: set[str] = {"_id"}
            preview_docs: list[dict] = []
            for doc in docs:
                row = doc.to_dict() or {}
                row["_id"] = doc.id
                field_set.update(row.keys())
                if len(preview_docs) < 5:
                    preview_docs.append({k: str(v) for k, v in row.items()})
            result.append({
                "collection": collection_name,
                "fields": sorted(field_set),
                "preview_docs": preview_docs,
            })
        except Exception as e:
            result.append({
                "collection": collection_name,
                "fields": ["_id"],
                "preview_docs": [],
                "_error": str(e),
            })
    return result


def _list_collections_sync(credentials_content: str) -> list[str]:
    """List top-level Firestore collections for the project."""
    from firebase_admin import firestore

    app = _get_firebase_app(credentials_content)
    db = firestore.client(app=app)
    return [col.id for col in db.collections()]


def _docs_to_df(docs: list[dict]):
    """Convert a list of Firestore document dicts to a pandas DataFrame."""
    import pandas as pd
    if not docs:
        return pd.DataFrame()
    return pd.json_normalize(docs)


def _run_pandas_code(code: str, dataframes: dict) -> Any:
    """
    Execute pandas code in a restricted namespace.
    `dataframes` is a dict of {collection_name: DataFrame}.
    Returns the result of the last expression or None.
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
    # Inject each collection DataFrame under its name and as "df" (first one)
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
        # Try to compile-and-exec all but last, then eval last
        body = "\n".join(lines[:-1])
        last = lines[-1].strip()
        if body:
            exec(body, safe_globals)  # noqa: S102
        result = eval(last, safe_globals)  # noqa: S307
        return result
    except Exception:
        # Fall back: exec everything
        exec(code, safe_globals)  # noqa: S102
        return safe_globals.get("result")


async def ask_firebase(
    credentials_content: str | None,
    project_id: str,
    collections: list[str],
    question: str,
    agent_description: str = "",
    source_name: str | None = None,
    collection_infos: list[dict] | None = None,
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    """
    Main entry point for Firebase Firestore Q&A.

    credentials_content: Firebase service account JSON string.
    collections: list of Firestore collection names to query.
    collection_infos: cached schema [{ "collection": "x", "fields": [...] }].
    """
    from app.llm.client import chat_completion
    from app.llm.charting import build_chart_input
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    if not credentials_content:
        raise ValueError("Firebase credentials_content is required")

    loop = asyncio.get_event_loop()

    # Get/refresh collection schema
    if not collection_infos or not any(ci.get("fields") for ci in collection_infos):
        collection_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_collection_infos_sync(credentials_content, collections),
        )

    # Build schema text for LLM
    schema_parts = [f"Project: {project_id}", f"Collections: {collections}"]
    for ci in collection_infos:
        schema_parts.append(
            f"\nCollection '{ci.get('collection', '')}': fields {ci.get('fields', [])}"
        )
        preview = ci.get("preview_docs", [])
        if preview:
            schema_parts.append(f"  Sample docs (up to 5): {json.dumps(preview[:3], ensure_ascii=False, default=str)}")
    schema_text = "\n".join(schema_parts)

    system = (
        "You are a data analyst assistant. The user has a Firebase Firestore database. "
        "You are given the collection schemas (field names) below. "
        "Answer the question by writing a short pandas Python code snippet that analyses the data. "
        "The DataFrames are pre-loaded; each collection is available as a variable named after it "
        "(e.g. collection 'orders' → variable `orders`, also available as `df` for the first collection). "
        "Return ONLY valid JSON with keys: "
        "\"answer\" (string — a brief natural language answer), "
        "\"followUpQuestions\" (array of up to 3 strings), "
        "\"pandasCode\" (string — Python/pandas code to compute the answer, or null if not needed). "
        "Any suggested follow-up questions must be answerable using only the available collections and fields. "
        "Do not include any extra text outside the JSON."
    )
    if agent_description:
        system += f"\nContext: {agent_description}"

    messages = [{"role": "system", "content": system}]
    if history:
        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn["question"]})
            messages.append({"role": "assistant", "content": turn["answer"]})
    messages.append({"role": "user", "content": f"Schema:\n{schema_text}\n\nQuestion: {question}"})

    raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    trace["stage"] = "pergunta_main"
    trace["source_type"] = "firebase"
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
            # Fetch documents for all collections and build DataFrames
            dataframes = {}
            for col_name in collections:
                docs = await loop.run_in_executor(
                    None,
                    lambda c=col_name: _fetch_collection_docs_sync(credentials_content, c),
                )
                dataframes[col_name] = _docs_to_df(docs)

            # Execute pandas code
            result_value = _run_pandas_code(pandas_code, dataframes)

            # Convert result to rows format for elaboration
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
            answer = f"{answer}\n\n*Erro ao executar o código no Firestore: {e}*"

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
    return {"answer": answer, "imageUrl": None, "followUpQuestions": follow_up, "chartInput": chart_input}


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
                return _coerce(json.loads(raw_clean[start: end + 1]), True)
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
