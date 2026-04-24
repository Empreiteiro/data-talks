"""
Studio Summary for CSV/XLSX: executive report from schema + sample profile + small sample only.
Never passes the full table; uses at most a few hundred rows for stats and up to 5 rows for sample.
"""
from pathlib import Path
from typing import Any
import json
import math

from app.scripts.ask_csv import _build_sample_profile, _format_profile, _safe_float

MAX_ROWS_FOR_STATS = 2000  # cap when reading file for profile
MAX_SAMPLE_ROWS_FOR_LLM = 5  # at most this many raw rows in the prompt

LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


def _lang_instruction(language: str | None) -> str:
    if language and language in LANGUAGE_NAMES:
        return f"Write ALL text output in {LANGUAGE_NAMES[language]}. "
    return "Write in the same language as the data (e.g. Portuguese if data is in Portuguese). "


def _format_schema(columns: list[str]) -> str:
    return "Columns: " + ", ".join(columns)


async def generate_table_summary_csv(
    file_path: str,
    source_name: str = "",
    data_files_dir: str = "./data_files",
    columns: list[str] | None = None,
    preview_rows: list[dict] | None = None,
    sample_profile: dict | None = None,
    sample_row_count: int | None = None,
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Returns: { "report": str (markdown), "queries_run": [] }.
    Uses only schema + profile + up to 5 sample rows; never the full table.
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log
    from app.services.storage import get_storage
    import pandas as pd

    full_path = get_storage().local_path(file_path)
    if not full_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    # Prefer metadata; otherwise read a capped sample to build profile
    if columns and sample_profile is not None and sample_row_count is not None:
        schema_text = _format_schema(columns)
        profile_text = _format_profile(sample_profile)
        row_count = sample_row_count
        raw_sample = (preview_rows or [])[:MAX_SAMPLE_ROWS_FOR_LLM]
        sample_rows = [dict((k, _safe_str(v)) for k, v in r.items()) for r in raw_sample]
    else:
        ext = full_path.suffix.lower()
        nrows = MAX_ROWS_FOR_STATS
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(full_path, nrows=nrows)
        else:
            df = pd.read_csv(full_path, nrows=nrows)
        columns = list(df.columns)
        schema_text = _format_schema(columns)
        sample_profile = _build_sample_profile(df)
        profile_text = _format_profile(sample_profile)
        row_count = len(df)
        sample_rows = df.head(MAX_SAMPLE_ROWS_FOR_LLM).to_dict(orient="records")
        sample_rows = [dict((k, _safe_str(v)) for k, v in r.items()) for r in sample_rows]

    sample_json = json.dumps(sample_rows, ensure_ascii=False, default=str) if sample_rows else "[]"

    system_report = (
        "You are a professional business analyst. Write a highly structured executive summary report in STRICT Markdown format. "
        "You MUST use heading indicators (#, ##), bold text (**bold**), and Markdown tables (|---|) exactly as shown in this template.\n\n"
        "### TEMPLATE:\n"
        "# [Dataset Title]\n\n"
        "## Overview\n"
        "[A brief summary of what the data represents and total row count.]\n\n"
        "## Data Description\n"
        "| Column | Type | Description |\n"
        "|---|---|---|\n"
        "| [col1] | [type] | [purpose] |\n"
        "| [col2] | [type] | [purpose] |\n\n"
        "## Key Insights\n"
        "- [**Insight 1:** Detail]\n"
        "- [**Insight 2:** Detail]\n\n"
        "## Data Quality\n"
        "[Notes on missing values, types, and potential issues.]\n\n"
        "## Conclusion\n"
        "[Brief recommendation for analysis.]\n\n"
        "Base your report ONLY on: the column list, the sample profile, total row count, and the tiny sample provided. "
        "Do not assume you have the full dataset. Keep it professional and concise. "
        f"{_lang_instruction(language)}"
        "Return ONLY the Markdown content with no preamble."
    )
    user_report = (
        f"Source name: {source_name or file_path}\n\n"
        f"Schema: {schema_text}\n"
        f"Total rows (in sample/metadata): {row_count}\n\n"
        f"Sample profile (column types, nulls, numeric stats, top values):\n{profile_text}\n\n"
        f"Sample rows (at most 5, for context only):\n{sample_json}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage, trace = await chat_completion(
        [{"role": "system", "content": system_report}, {"role": "user", "content": user_report}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    trace["stage"] = "summary_csv"
    await record_log(
        action="summary",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name or file_path,
        channel=channel,
        trace=trace,
    )
    report = (report or "").strip()
    return {"report": report, "queries_run": []}


def _safe_str(v: Any) -> Any:
    if v is None or (isinstance(v, float) and (math.isnan(v) or not math.isfinite(v))):
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v
