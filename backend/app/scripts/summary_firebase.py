"""
Studio Summary: generate executive report for Firebase Firestore collections.
1. Fetch sample docs from each collection to understand structure.
2. Use LLM to ask analytical questions (as pandas code).
3. Execute code and collect results.
4. Use LLM to write a concise executive summary in Markdown.
"""
from typing import Any
import asyncio
import json
import re

MAX_DOCS_PER_COLLECTION = 500   # docs loaded for pandas analysis
MAX_ROWS_RESULT = 15            # result rows shown to LLM in report

LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


def _lang_instruction(language: str | None) -> str:
    if language and language in LANGUAGE_NAMES:
        return f"Write ALL text output in {LANGUAGE_NAMES[language]}. "
    return "Write in the same language as the data (e.g. Portuguese if data is in Portuguese). "


async def generate_table_summary_firebase(
    credentials_content: str | None,
    project_id: str,
    collections: list[str],
    collection_infos: list[dict] | None = None,
    source_name: str = "",
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Returns: { "report": str (markdown), "queries_run": [ { "query": str, "rows": list }, ... ] }
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log
    from app.scripts.ask_firebase import (
        _fetch_collection_infos_sync,
        _fetch_collection_docs_sync,
        _docs_to_df,
        _run_pandas_code,
    )

    if not credentials_content:
        raise ValueError("Firebase credentials_content is required")

    loop = asyncio.get_event_loop()

    # Ensure we have collection schema
    if not collection_infos or not any(ci.get("fields") for ci in collection_infos):
        collection_infos = await loop.run_in_executor(
            None,
            lambda: _fetch_collection_infos_sync(credentials_content, collections),
        )

    # Build schema text
    schema_parts = [f"Project: {project_id}", f"Collections: {collections}"]
    for ci in collection_infos:
        schema_parts.append(
            f"\nCollection '{ci.get('collection', '')}': fields {ci.get('fields', [])}"
        )
    schema_text = "\n".join(schema_parts)

    # Step 1: LLM suggests 3-5 analytical pandas snippets
    system_queries = (
        "You are a data analyst. Given the Firestore collection schema below, suggest 3 to 5 short "
        "Python/pandas code snippets to analyse the data: e.g. document count (len(df)), "
        "value counts of key fields (df['field'].value_counts()), "
        "numeric summaries (df['field'].describe()), recent or top-N rows. "
        "Each collection DataFrame is available as a variable named after the collection (e.g. `orders`, `users`). "
        "The first collection is also available as `df`. "
        "Return ONLY a JSON object with one key: \"queries\" (array of strings). "
        "Each string is a single Python/pandas expression. No markdown, no explanation outside the JSON."
    )
    msg_queries = (
        f"Schema:\n{schema_text}\n\nGenerate 3-5 analytical pandas code snippets for these collections. "
        'Return JSON with key "queries" (array of Python/pandas expression strings).'
    )
    raw_queries, usage1, trace1 = await chat_completion(
        [{"role": "system", "content": system_queries}, {"role": "user", "content": msg_queries}],
        max_tokens=1024,
        llm_overrides=llm_overrides,
    )
    trace1["stage"] = "summary_firebase_queries"
    await record_log(
        action="summary",
        provider=usage1.get("provider", ""),
        model=usage1.get("model", ""),
        input_tokens=usage1.get("input_tokens", 0),
        output_tokens=usage1.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace1,
    )
    code_snippets = _parse_queries_json(raw_queries)

    # Step 2: Load DataFrames and execute each snippet
    dataframes: dict[str, Any] = {}
    for col_name in collections:
        docs = await loop.run_in_executor(
            None,
            lambda c=col_name: _fetch_collection_docs_sync(credentials_content, c, limit=MAX_DOCS_PER_COLLECTION),
        )
        dataframes[col_name] = _docs_to_df(docs)

    queries_run: list[dict] = []
    for snippet in code_snippets:
        snippet = (snippet or "").strip()
        if not snippet:
            continue
        try:
            result = _run_pandas_code(snippet, dataframes)
            rows = _result_to_rows_capped(result, MAX_ROWS_RESULT)
            queries_run.append({"query": snippet, "rows": rows})
        except Exception as e:
            queries_run.append({"query": snippet, "rows": [], "error": str(e)})

    # Step 3: LLM writes executive summary from schema + results
    results_text = ""
    for i, item in enumerate(queries_run, 1):
        results_text += f"\n--- Snippet {i} ---\n{item.get('query', '')}\n"
        if item.get("error"):
            results_text += f"Error: {item['error']}\n"
        else:
            rows = item.get("rows") or []
            if not rows:
                results_text += "Result: 0 rows.\n"
            else:
                results_text += f"Result ({len(rows)} row(s)):\n{json.dumps(rows, ensure_ascii=False, default=str)}\n"

    system_report = (
        "You are a professional data analyst. Write a highly structured executive summary in STRICT Markdown format. "
        "You MUST use heading indicators (#, ##), bold text (**bold**), and Markdown tables (|---|) exactly as shown in this template.\n\n"
        "### TEMPLATE:\n"
        "# [Collection Name] Executive Summary\n\n"
        "## Overview\n"
        "[Briefly describe what the collection represents and its likely purpose.]\n\n"
        "## Data Description\n"
        "| Field | Type | Description |\n"
        "|---|---|---|\n"
        "| [field1] | [type] | [what it represents] |\n"
        "| [field2] | [type] | [what it represents] |\n\n"
        "## Findings & Metrics\n"
        "- [**Insight 1:** Key insights, document counts, and summary statistics]\n"
        "- [**Insight 2:** Notable top values or distributions observed]\n\n"
        "## Data Quality & Caveats\n"
        "[Any NULL values, quality issues, or structural notes.]\n\n"
        "Base your report ONLY on the schema, profiling data, and tiny sample provided. "
        "Keep it professional and concise (about 1-2 pages). "
        f"{_lang_instruction(language)}"
        "Return ONLY the Markdown content with no preamble."
    )
    user_report = (
        f"Collection name: {source_name or (collection_infos[0].get('collection') if collection_infos else '')}\n\n"
        f"Schema:\n{schema_text}\n\n"
        f"Analysis results:\n{results_text}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage2, trace2 = await chat_completion(
        [{"role": "system", "content": system_report}, {"role": "user", "content": user_report}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    trace2["stage"] = "summary_firebase_report"
    await record_log(
        action="summary",
        provider=usage2.get("provider", ""),
        model=usage2.get("model", ""),
        input_tokens=usage2.get("input_tokens", 0),
        output_tokens=usage2.get("output_tokens", 0),
        source=source_name,
        channel=channel,
        trace=trace2,
    )
    report = (report or "").strip()

    return {"report": report, "queries_run": queries_run}


def _result_to_rows_capped(value: Any, max_rows: int) -> list[dict]:
    """Convert pandas result to capped list of dicts for the LLM report."""
    if value is None:
        return []
    try:
        import pandas as pd
        if isinstance(value, pd.DataFrame):
            return value.head(max_rows).to_dict(orient="records")
        if isinstance(value, pd.Series):
            return value.head(max_rows).reset_index().to_dict(orient="records")
        if isinstance(value, (int, float, str, bool)):
            return [{"value": value}]
        if isinstance(value, (list, dict)):
            rows = value if isinstance(value, list) else [value]
            return rows[:max_rows]
    except Exception:
        pass
    return []


def _parse_queries_json(raw: str) -> list[str]:
    raw_clean = raw.strip()
    raw_clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_clean, flags=re.IGNORECASE)
    try:
        data = json.loads(raw_clean)
        qs = data.get("queries") if isinstance(data, dict) else None
        if isinstance(qs, list):
            return [str(x).strip() for x in qs if x]
    except json.JSONDecodeError:
        start = raw_clean.find("{")
        end = raw_clean.rfind("}")
        if start != -1 and end > start:
            try:
                data = json.loads(raw_clean[start: end + 1])
                qs = data.get("queries") if isinstance(data, dict) else None
                if isinstance(qs, list):
                    return [str(x).strip() for x in qs if x]
            except json.JSONDecodeError:
                pass
    return []
