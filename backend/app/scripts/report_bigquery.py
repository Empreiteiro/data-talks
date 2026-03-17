"""
Studio Report for BigQuery: fetches sample data into a DataFrame and delegates to report_generator.
"""
import asyncio
from typing import Any

import pandas as pd

from app.scripts.ask_bigquery import _get_bigquery_client, _run_query_sync
from app.scripts.report_generator import generate_report, MAX_ROWS_FOR_PROFILE


async def generate_report_bigquery(
    credentials_content: str | None,
    project_id: str,
    dataset_id: str,
    tables: list[str],
    table_infos: list[dict] | None = None,
    source_name: str = "",
    llm_overrides: dict | None = None,
    channel: str = "studio",
) -> dict[str, Any]:
    """
    Returns: {"html_content": str, "chart_count": int}
    """
    loop = asyncio.get_event_loop()
    client = await loop.run_in_executor(None, lambda: _get_bigquery_client(credentials_content))

    # Use the first table (or the most relevant one) for the report
    target_table = tables[0] if tables else ""
    if not target_table and table_infos:
        target_table = table_infos[0].get("table", "") or table_infos[0].get("table_name", "")

    full_table = f"`{project_id}.{dataset_id}.{target_table}`"
    query = f"SELECT * FROM {full_table} LIMIT {MAX_ROWS_FOR_PROFILE}"

    rows = await loop.run_in_executor(None, lambda: _run_query_sync(client, query))
    if not rows:
        raise ValueError(f"No data returned from BigQuery table: {target_table}")

    df = pd.DataFrame(rows)

    return await generate_report(
        df=df,
        source_name=source_name or target_table,
        llm_overrides=llm_overrides,
        channel=channel,
    )
