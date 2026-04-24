"""
Studio Report for CSV/XLSX: loads DataFrame and delegates to report_generator.
"""
from pathlib import Path
from typing import Any

import pandas as pd

from app.scripts.report_generator import generate_report, MAX_ROWS_FOR_PROFILE


async def generate_report_csv(
    file_path: str,
    source_name: str = "",
    data_files_dir: str = "./data_files",
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Returns: {"html_content": str, "chart_count": int}
    """
    from app.services.storage import get_storage
    full_path = get_storage().local_path(file_path)
    if not full_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = full_path.suffix.lower()
    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(full_path, nrows=MAX_ROWS_FOR_PROFILE)
    else:
        df = pd.read_csv(full_path, nrows=MAX_ROWS_FOR_PROFILE)

    return await generate_report(
        df=df,
        source_name=source_name or file_path,
        llm_overrides=llm_overrides,
        channel=channel,
        language=language,
    )
