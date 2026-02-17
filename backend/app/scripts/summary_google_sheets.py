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
        "You are a business analyst. Write a short executive summary (report) in Markdown that describes "
        "what this Google Sheet likely contains, based ONLY on the spreadsheet/sheet identifiers and the list of column names. "
        "Do not assume you have any row data. Infer the purpose of the sheet and the meaning of columns from their names. "
        "Keep it concise (about 1 page). Include: probable purpose of the sheet, what each column likely represents, "
        "and any data quality or structure notes. Use clear headings and bullet points."
    )
    user_report = (
        f"Source name: {source_name or sheet_name}\n"
        f"Spreadsheet ID: {spreadsheet_id}\n"
        f"Sheet name: {sheet_name}\n\n"
        f"Schema (column names only): {schema_text}\n\n"
        "Write the executive summary (Markdown only, no preamble)."
    )
    report, usage = await chat_completion(
        [{"role": "system", "content": system_report}, {"role": "user", "content": user_report}],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    await record_log(
        action="summary",
        provider=usage.get("provider", ""),
        model=usage.get("model", ""),
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        source=source_name or sheet_name,
    )
    report = (report or "").strip()
    return {"report": report, "queries_run": []}
