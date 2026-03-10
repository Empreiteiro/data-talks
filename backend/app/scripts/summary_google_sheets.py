"""
Studio Summary for Google Sheets: executive report from schema (column names) only.
No full table or row data is passed; avoids token cost and avoids requiring sheet read API.
"""
from typing import Any


async def generate_table_summary_google_sheets(
    spreadsheet_id: str,
    sheet_name: str,
    available_columns: list[str] | None,
    source_name: str = "",
    llm_overrides: dict | None = None,
    channel: str = "studio",
) -> dict[str, Any]:
    """
    Returns: { "report": str (markdown), "queries_run": [] }.
    Uses only column names (schema); no row data.
    """
    from app.llm.client import chat_completion
    from app.llm.logs import record_log

    columns = available_columns or []
    schema_text = "Columns: " + ", ".join(columns) if columns else "No columns (sheet may be empty or not loaded)."

    system_report = (
        "You are a professional business analyst. Write a highly structured executive summary in STRICT Markdown format "
        "based ONLY on the Google Sheet column names. "
        "You MUST use heading indicators (#, ##), bold text (**bold**), and Markdown tables (|---|) exactly as shown in this template.\n\n"
        "### TEMPLATE:\n"
        "# [Sheet Title] Executive Summary\n\n"
        "## Purpose\n"
        "[Probable purpose of the sheet based on name and columns.]\n\n"
        "## Structure\n"
        "| Column | Description |\n"
        "|---|---|\n"
        "| [col1] | [what it likely represents] |\n"
        "| [col2] | [what it likely represents] |\n\n"
        "## Notes\n"
        "[Any data quality or structural observations.]\n\n"
        "Keep it professional and concise (about 1 page). "
        "Return ONLY the Markdown content with no preamble."
    )
    user_report = (
        f"Source name: {source_name or sheet_name}\n"
        f"Spreadsheet ID: {spreadsheet_id}\n"
        f"Sheet name: {sheet_name}\n\n"
        f"Schema (column names only): {schema_text}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage, trace = await chat_completion(
        [{"role": "system", "content": system_report}, {"role": "user", "content": user_report}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    trace["stage"] = "summary_google_sheets"
    await record_log(
        action="summary",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name or sheet_name,
        channel=channel,
        trace=trace,
    )
    report = (report or "").strip()
    return {"report": report, "queries_run": []}
