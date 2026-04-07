"""
Studio Report for Google Sheets: fetches sheet data into a DataFrame and delegates to report_generator.
"""
import asyncio
from typing import Any

import pandas as pd

from app.scripts.report_generator import generate_report, MAX_ROWS_FOR_PROFILE


def _fetch_sheet_df(spreadsheet_id: str, sheet_name: str) -> pd.DataFrame:
    """Fetch sheet data using gspread."""
    import gspread
    from google.oauth2.service_account import Credentials

    # Use default credentials or service account
    try:
        gc = gspread.service_account()
    except Exception:
        # Fallback: try with default oauth
        gc = gspread.oauth()

    spreadsheet = gc.open_by_key(spreadsheet_id)
    worksheet = spreadsheet.worksheet(sheet_name)
    records = worksheet.get_all_records()
    return pd.DataFrame(records[:MAX_ROWS_FOR_PROFILE])


async def generate_report_google_sheets(
    spreadsheet_id: str,
    sheet_name: str,
    source_name: str = "",
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Returns: {"html_content": str, "chart_count": int}
    """
    loop = asyncio.get_event_loop()
    df = await loop.run_in_executor(
        None, lambda: _fetch_sheet_df(spreadsheet_id, sheet_name)
    )

    if df.empty:
        raise ValueError("No data returned from Google Sheet")

    return await generate_report(
        df=df,
        source_name=source_name or sheet_name,
        llm_overrides=llm_overrides,
        channel=channel,
        language=language,
    )
