"""
Studio Report for SQL databases: fetches sample data into a DataFrame and delegates to report_generator.
"""
import asyncio
from typing import Any

import pandas as pd
from sqlalchemy import create_engine, text

from app.scripts.report_generator import generate_report, MAX_ROWS_FOR_PROFILE


def _fetch_sample_df(connection_string: str, table_infos: list[dict], limit: int) -> pd.DataFrame:
    """Fetch sample data from the first table."""
    engine = create_engine(connection_string)
    target_table = table_infos[0].get("table", "") or table_infos[0].get("table_name", "")
    if not target_table:
        raise ValueError("No table name found in table_infos")

    query = f"SELECT * FROM {target_table} LIMIT {limit}"
    with engine.connect() as conn:
        result = conn.execute(text(query))
        rows = result.mappings().fetchall()
    return pd.DataFrame([dict(r) for r in rows])


async def generate_report_sql(
    connection_string: str,
    table_infos: list[dict] | None,
    source_name: str = "",
    llm_overrides: dict | None = None,
    channel: str = "studio",
    language: str | None = None,
) -> dict[str, Any]:
    """
    Returns: {"html_content": str, "chart_count": int}
    """
    if not table_infos:
        raise ValueError("SQL source requires table_infos (schema)")

    loop = asyncio.get_event_loop()
    df = await loop.run_in_executor(
        None, lambda: _fetch_sample_df(connection_string, table_infos, MAX_ROWS_FOR_PROFILE)
    )

    if df.empty:
        raise ValueError("No data returned from SQL table")

    table_name = table_infos[0].get("table", "") or table_infos[0].get("table_name", "")

    return await generate_report(
        df=df,
        source_name=source_name or table_name,
        llm_overrides=llm_overrides,
        channel=channel,
        language=language,
    )
