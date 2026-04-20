"""
Medallion Architecture service — Bronze / Silver / Gold SQL generation.

This service generates SQL suggestions for a medallion architecture
(Bronze → Silver → Gold) but does NOT execute any SQL on client databases.

All suggestions, schemas, and generated SQL are stored in the app DB
(MedallionLayer, MedallionBuildLog) for the user to review, copy,
and apply externally.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MedallionLayer, MedallionBuildLog, Source
from app.llm.client import chat_completion
from app.scripts.ask_csv import _load_full_dataframe, _build_sample_profile, _format_profile
from app.services.lineage import tracked_run, record_edge

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid() -> str:
    return str(uuid.uuid4())


def _short_id(source_id: str) -> str:
    """First 8 chars of the source UUID (safe for table names)."""
    return source_id.replace("-", "")[:8]


def _layer_to_dict(layer: MedallionLayer) -> dict:
    return {
        "id": layer.id,
        "sourceId": layer.source_id,
        "agentId": layer.agent_id,
        "layer": layer.layer,
        "tableName": layer.table_name,
        "status": layer.status,
        "schemaConfig": layer.schema_config or {},
        "ddlSql": layer.ddl_sql or "",
        "transformSql": layer.transform_sql,
        "rowCount": layer.row_count,
        "errorMessage": layer.error_message,
        "createdAt": layer.created_at.isoformat() if layer.created_at else None,
        "updatedAt": layer.updated_at.isoformat() if layer.updated_at else None,
    }


def _log_to_dict(entry: MedallionBuildLog) -> dict:
    return {
        "id": entry.id,
        "layerId": entry.layer_id,
        "action": entry.action,
        "layer": entry.layer,
        "inputFeedback": entry.input_feedback,
        "suggestion": entry.suggestion,
        "appliedConfig": entry.applied_config,
        "llmUsage": entry.llm_usage,
        "errorMessage": entry.error_message,
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
    }


# ---------------------------------------------------------------------------
# Bronze — generate DDL (no execution)
# ---------------------------------------------------------------------------

async def generate_bronze(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
) -> dict:
    """Generate Bronze DDL from raw source file. Does NOT execute SQL."""
    async with tracked_run(
        db,
        user_id=user_id,
        kind="medallion_bronze",
        agent_id=agent_id,
        metadata={"source_id": source.id, "source_name": source.name},
    ) as run:
        meta = source.metadata_ or {}
        file_path_str = meta.get("file_path", "")
        if not file_path_str:
            raise ValueError("Source has no file_path in metadata")

        full_path = Path(data_files_dir) / file_path_str
        if not full_path.exists():
            raise FileNotFoundError(f"Source file not found: {full_path}")

        df = _load_full_dataframe(full_path)
        sid = _short_id(source.id)
        table_name = f"bronze_{sid}"
        row_count = len(df)

        # Build DDL: all columns as TEXT + metadata columns
        col_defs = [
            "_loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "_source_file TEXT",
            "_row_hash TEXT",
        ]
        for col in df.columns:
            safe_col = str(col).replace('"', '""')
            col_defs.append(f'"{safe_col}" TEXT')

        ddl = f'CREATE TABLE IF NOT EXISTS "{table_name}" (\n  ' + ",\n  ".join(col_defs) + "\n);"

        schema_config = {
            "columns": [str(c) for c in df.columns],
            "metadata_columns": ["_loaded_at", "_source_file", "_row_hash"],
            "row_count": row_count,
        }

        # Delete existing bronze layer if any
        old = await db.execute(
            select(MedallionLayer).where(
                MedallionLayer.source_id == source.id,
                MedallionLayer.layer == "bronze",
            )
        )
        for old_layer in old.scalars().all():
            await db.delete(old_layer)

        layer = MedallionLayer(
            id=_uid(),
            user_id=user_id,
            source_id=source.id,
            agent_id=agent_id,
            layer="bronze",
            table_name=table_name,
            status="ready",
            schema_config=schema_config,
            ddl_sql=ddl,
            row_count=row_count,
        )
        db.add(layer)

        build_log = MedallionBuildLog(
            id=_uid(),
            layer_id=layer.id,
            source_id=source.id,
            user_id=user_id,
            action="suggest",
            layer="bronze",
            suggestion=schema_config,
        )
        db.add(build_log)
        await db.flush()

        # Lineage: source file -> bronze layer table
        await record_edge(
            db,
            run,
            source_kind="source",
            source_ref=source.id,
            target_kind="table",
            target_ref=f"medallion_layers:{layer.id}",
            edge_type="read",
            metadata={"table_name": table_name, "row_count": row_count},
        )

        return _layer_to_dict(layer)


# ---------------------------------------------------------------------------
# Silver — Suggest
# ---------------------------------------------------------------------------

_SILVER_SYSTEM_PROMPT = """\
You are a data engineer. Analyze this raw data profile from a Bronze (raw staging) layer \
and suggest a Silver (cleaned) schema.

All Bronze columns are stored as TEXT. For each column, suggest:
1. **target_type**: The appropriate SQL data type to cast to. One of: INTEGER, REAL, TEXT, DATE, TIMESTAMP, BOOLEAN, DECIMAL
2. **transform**: Optional extra transformation to apply BEFORE casting. One of:
   - "none" (just cast the column as-is)
   - "trim" (TRIM whitespace)
   - "lower_trim" (LOWER + TRIM, good for emails/slugs)
   - "remove_commas" (REPLACE commas then cast, good for "1,234.56" numbers)
   - "strip_currency" (remove $€£ symbols then cast)
3. **null_strategy**: How to handle NULL/empty values. One of: KEEP_NULL, DROP_ROW, FILL_ZERO, FILL_DEFAULT
4. **null_default**: Default value when null_strategy is FILL_DEFAULT (optional, ignored otherwise)
5. **silver_name**: Cleaned snake_case column name

Also suggest deduplication if you detect a primary key candidate:
- **dedup_key**: list of source_column names forming the unique key (empty list if no dedup needed)
- **dedup_order_by**: source_column to ORDER BY DESC for keeping latest row (null if no dedup)

IMPORTANT: source_column must EXACTLY match one of the Bronze column names provided. Do NOT invent column names.

Return ONLY valid JSON in this exact format:
{
  "columns": [
    {
      "source_column": "Revenue",
      "silver_name": "revenue",
      "target_type": "REAL",
      "transform": "remove_commas",
      "null_strategy": "FILL_ZERO",
      "null_default": null
    },
    {
      "source_column": "Email Address",
      "silver_name": "email",
      "target_type": "TEXT",
      "transform": "lower_trim",
      "null_strategy": "KEEP_NULL",
      "null_default": null
    }
  ],
  "dedup_key": [],
  "dedup_order_by": null,
  "explanation": "Brief explanation of your choices"
}
"""


async def suggest_silver(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    feedback: str | None = None,
) -> dict:
    """Use LLM to suggest silver schema. Returns suggestion + SQL previews (no execution)."""
    # Get bronze layer for column info
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.source_id == source.id,
            MedallionLayer.layer == "bronze",
            MedallionLayer.status == "ready",
        )
    )
    bronze = result.scalar_one_or_none()
    if not bronze:
        raise ValueError("Bronze layer must be generated first")

    # Load source data for profiling (from original file, NOT from any client DB)
    meta = source.metadata_ or {}
    file_path_str = meta.get("file_path", "")
    full_path = Path(data_files_dir) / file_path_str
    if not full_path.exists():
        raise FileNotFoundError(f"Source file not found: {full_path}")

    df = _load_full_dataframe(full_path)
    data_cols = [str(c) for c in df.columns]

    profile = _build_sample_profile(df.head(1000))
    profile_text = _format_profile(profile)

    user_msg = f"""Bronze table: {bronze.table_name}
Columns (all stored as TEXT): {', '.join(data_cols)}
Row count: {bronze.row_count}

Data profile:
{profile_text}

Sample rows (first 3):
{df.head(3).to_string(index=False)}
"""

    if feedback:
        user_msg += f"\n\nUser feedback on previous suggestion — please adjust accordingly:\n{feedback}"

    messages = [
        {"role": "system", "content": _SILVER_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw_content, usage, _trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)

    suggestion = _parse_json_response(raw_content)
    sid = _short_id(source.id)

    # Generate SQL previews (for display only — never executed)
    ddl_preview = _build_silver_ddl(suggestion, sid)
    transform_preview = _build_silver_transform(suggestion, bronze.table_name, f"silver_{sid}")

    action = "redo" if feedback else "suggest"
    build_log = MedallionBuildLog(
        id=_uid(),
        source_id=source.id,
        user_id=user_id,
        action=action,
        layer="silver",
        input_feedback=feedback,
        suggestion=suggestion,
        llm_usage=usage,
    )
    db.add(build_log)
    await db.flush()

    return {
        "suggestion": suggestion,
        "ddlPreview": ddl_preview,
        "transformPreview": transform_preview,
        "buildLogId": build_log.id,
    }


# ---------------------------------------------------------------------------
# Silver — Save (stores accepted config + SQL, no execution)
# ---------------------------------------------------------------------------

async def apply_silver(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
    build_log_id: str,
    config: dict,
) -> dict:
    """Save user-accepted silver config and generated SQL. Does NOT execute SQL."""
    async with tracked_run(
        db,
        user_id=user_id,
        kind="medallion_silver",
        agent_id=agent_id,
        metadata={"source_id": source.id, "build_log_id": build_log_id},
    ) as run:
        result = await db.execute(
            select(MedallionLayer).where(
                MedallionLayer.source_id == source.id,
                MedallionLayer.layer == "bronze",
                MedallionLayer.status == "ready",
            )
        )
        bronze = result.scalar_one_or_none()
        if not bronze:
            raise ValueError("Bronze layer must be generated first")

        sid = _short_id(source.id)
        silver_table = f"silver_{sid}"
        ddl = _build_silver_ddl(config, sid)
        transform = _build_silver_transform(config, bronze.table_name, silver_table)

        # Delete existing silver layer if any
        old = await db.execute(
            select(MedallionLayer).where(
                MedallionLayer.source_id == source.id,
                MedallionLayer.layer == "silver",
            )
        )
        for old_layer in old.scalars().all():
            await db.delete(old_layer)

        layer = MedallionLayer(
            id=_uid(),
            user_id=user_id,
            source_id=source.id,
            agent_id=agent_id,
            layer="silver",
            table_name=silver_table,
            status="ready",
            schema_config=config,
            ddl_sql=ddl,
            transform_sql=transform,
            row_count=bronze.row_count,  # estimated from bronze
        )
        db.add(layer)

        apply_log = MedallionBuildLog(
            id=_uid(),
            layer_id=layer.id,
            source_id=source.id,
            user_id=user_id,
            action="save",
            layer="silver",
            applied_config=config,
        )
        db.add(apply_log)
        await db.flush()

        # Lineage: bronze layer -> silver layer (transform)
        await record_edge(
            db,
            run,
            source_kind="table",
            source_ref=f"medallion_layers:{bronze.id}",
            target_kind="table",
            target_ref=f"medallion_layers:{layer.id}",
            edge_type="transform",
            metadata={"silver_table": silver_table, "columns": len(config.get("columns") or [])},
        )

        return _layer_to_dict(layer)


# ---------------------------------------------------------------------------
# Gold — Suggest
# ---------------------------------------------------------------------------

_GOLD_SYSTEM_PROMPT = """\
You are a data analyst. Given this Silver (cleaned) layer schema, suggest useful \
business aggregate tables (Gold layer).

Suggest 3-5 Gold tables with:
1. **name**: short snake_case identifier (e.g., "monthly_revenue")
2. **description**: one-line business explanation
3. **sql**: A SELECT query against the silver table that creates this aggregate. \
Use standard SQL. Include GROUP BY for aggregates.
4. **dimensions**: list of grouping columns
5. **measures**: list of {column, agg_func, alias} objects

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "name": "monthly_revenue",
      "description": "Monthly revenue totals",
      "sql": "SELECT strftime('%Y-%m', created_at) AS month, SUM(revenue) AS total_revenue FROM silver_abc123 GROUP BY 1",
      "dimensions": ["month"],
      "measures": [{"column": "revenue", "agg_func": "SUM", "alias": "total_revenue"}],
      "explanation": "..."
    }
  ]
}
"""


async def suggest_gold(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    feedback: str | None = None,
    report_prompt: str | None = None,
) -> dict:
    """Use LLM to suggest gold aggregate tables. Returns suggestions + SQL previews (no execution)."""
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.source_id == source.id,
            MedallionLayer.layer == "silver",
            MedallionLayer.status == "ready",
        )
    )
    silver = result.scalar_one_or_none()
    if not silver:
        raise ValueError("Silver layer must be saved first")

    # Build column info from the saved silver schema config
    silver_config = silver.schema_config or {}
    silver_columns = silver_config.get("columns", [])

    col_desc = "\n".join(
        f"- {c.get('silver_name', c.get('source_column', '?'))} ({c.get('target_type', 'TEXT')})"
        for c in silver_columns
    )

    # Load a sample from the original file for context
    meta = source.metadata_ or {}
    file_path_str = meta.get("file_path", "")
    sample_text = ""
    if file_path_str:
        full_path = Path(data_files_dir) / file_path_str
        if full_path.exists():
            df = _load_full_dataframe(full_path)
            sample_text = df.head(5).to_string(index=False)

    user_msg = f"""Silver table: {silver.table_name}
Row count: {silver.row_count}

Columns (cleaned types):
{col_desc}

Sample data from source (first 5 rows):
{sample_text}
"""

    if report_prompt:
        user_msg += f"\n\nThe user wants to build a specific report. Focus your suggestions on this goal:\n{report_prompt}"

    if feedback:
        user_msg += f"\n\nUser feedback on previous suggestions — please adjust accordingly:\n{feedback}"

    messages = [
        {"role": "system", "content": _GOLD_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw_content, usage, _trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    parsed = _parse_json_response(raw_content)
    suggestions = parsed.get("suggestions", [])

    # Generate DDL previews (for display only)
    sid = _short_id(source.id)
    ddl_previews = []
    for s in suggestions:
        gold_table = f"gold_{sid}_{s.get('name', 'agg')}"
        sql = s.get("sql", "")
        ddl = f'CREATE TABLE IF NOT EXISTS "{gold_table}" AS\n{sql};'
        ddl_previews.append(ddl)

    action = "redo" if feedback else "suggest"
    build_log = MedallionBuildLog(
        id=_uid(),
        source_id=source.id,
        user_id=user_id,
        action=action,
        layer="gold",
        input_feedback=feedback,
        suggestion={"suggestions": suggestions},
        llm_usage=usage,
    )
    db.add(build_log)
    await db.flush()

    return {
        "suggestions": suggestions,
        "ddlPreviews": ddl_previews,
        "buildLogId": build_log.id,
    }


# ---------------------------------------------------------------------------
# Gold — Save (stores accepted config + SQL, no execution)
# ---------------------------------------------------------------------------

async def apply_gold(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
    build_log_id: str,
    selected_tables: list[dict],
) -> list[dict]:
    """Save selected gold aggregate configs and SQL. Does NOT execute SQL."""
    async with tracked_run(
        db,
        user_id=user_id,
        kind="medallion_gold",
        agent_id=agent_id,
        metadata={
            "source_id": source.id,
            "build_log_id": build_log_id,
            "table_count": len(selected_tables),
        },
    ) as run:
        sid = _short_id(source.id)
        layers = []

        # Look up silver layer once to use as lineage source for all gold tables
        silver_result = await db.execute(
            select(MedallionLayer).where(
                MedallionLayer.source_id == source.id,
                MedallionLayer.layer == "silver",
                MedallionLayer.status == "ready",
            )
        )
        silver = silver_result.scalar_one_or_none()
        silver_ref = f"medallion_layers:{silver.id}" if silver else f"source:{source.id}"
        silver_kind = "table" if silver else "source"

        for tbl in selected_tables:
            name = tbl.get("name", "agg")
            sql = tbl.get("sql", "")
            gold_table = f"gold_{sid}_{name}"
            create_sql = f'CREATE TABLE IF NOT EXISTS "{gold_table}" AS\n{sql};'

            layer = MedallionLayer(
                id=_uid(),
                user_id=user_id,
                source_id=source.id,
                agent_id=agent_id,
                layer="gold",
                table_name=gold_table,
                status="ready",
                schema_config=tbl,
                ddl_sql=create_sql,
                transform_sql=sql,
            )
            db.add(layer)

            apply_log = MedallionBuildLog(
                id=_uid(),
                layer_id=layer.id,
                source_id=source.id,
                user_id=user_id,
                action="save",
                layer="gold",
                applied_config=tbl,
            )
            db.add(apply_log)
            layers.append(_layer_to_dict(layer))

            # Lineage: silver -> gold (one edge per table)
            await record_edge(
                db,
                run,
                source_kind=silver_kind,
                source_ref=silver_ref if silver_kind == "table" else source.id,
                target_kind="table",
                target_ref=f"medallion_layers:{layer.id}",
                edge_type="derive",
                metadata={"gold_table": gold_table, "name": name},
            )

        await db.flush()
        return layers


# ---------------------------------------------------------------------------
# SQL Generation helpers
# ---------------------------------------------------------------------------

def _build_silver_ddl(config: dict, short_id: str) -> str:
    """Generate CREATE TABLE DDL for silver layer from config."""
    silver_table = f"silver_{short_id}"
    columns = config.get("columns", [])
    col_defs = []
    for col in columns:
        name = col.get("silver_name", col.get("source_column", "unknown"))
        dtype = col.get("target_type", "TEXT")
        safe_name = name.replace('"', '""')
        col_defs.append(f'  "{safe_name}" {dtype}')

    if not col_defs:
        return f'CREATE TABLE IF NOT EXISTS "{silver_table}" (id TEXT);'

    return f'CREATE TABLE IF NOT EXISTS "{silver_table}" (\n' + ",\n".join(col_defs) + "\n);"


def _build_cast_expression(source_col_quoted: str, target_type: str, transform: str) -> str:
    """Build a safe CAST expression from structured params."""
    expr = source_col_quoted

    if transform == "trim":
        expr = f"TRIM({expr})"
    elif transform == "lower_trim":
        expr = f"LOWER(TRIM({expr}))"
    elif transform == "remove_commas":
        expr = f"REPLACE({expr}, ',', '')"
    elif transform == "strip_currency":
        expr = f"REPLACE(REPLACE(REPLACE(REPLACE({expr}, '$', ''), '€', ''), '£', ''), ',', '')"

    if target_type and target_type.upper() != "TEXT":
        expr = f"CAST({expr} AS {target_type})"

    return expr


def _build_silver_transform(config: dict, bronze_table: str, silver_table: str) -> str:
    """Generate INSERT INTO ... SELECT SQL for silver layer from config."""
    columns = config.get("columns", [])
    dedup_key = config.get("dedup_key", [])
    dedup_order = config.get("dedup_order_by")

    select_exprs = []
    target_cols = []
    for col in columns:
        source_col = col.get("source_column", "")
        safe_source = source_col.replace('"', '""')
        source_col_quoted = f'"{safe_source}"'

        target_type = col.get("target_type", "TEXT")
        transform = col.get("transform", "none")
        expr = _build_cast_expression(source_col_quoted, target_type, transform)

        alias = col.get("silver_name", source_col)
        safe_alias = alias.replace('"', '""')
        target_cols.append(f'"{safe_alias}"')

        null_strategy = col.get("null_strategy", "KEEP_NULL")
        null_default = col.get("null_default")

        if null_strategy == "FILL_ZERO":
            expr = f"COALESCE({expr}, 0)"
        elif null_strategy == "FILL_DEFAULT" and null_default is not None:
            safe_default = str(null_default).replace("'", "''")
            expr = f"COALESCE({expr}, '{safe_default}')"

        select_exprs.append(f"  {expr} AS \"{safe_alias}\"")

    select_clause = ",\n".join(select_exprs)

    drop_conditions = []
    for col in columns:
        if col.get("null_strategy") == "DROP_ROW":
            src = col.get("source_column", "")
            drop_conditions.append(f'"{src}" IS NOT NULL')

    where_clause = ""
    if drop_conditions:
        where_clause = "\nWHERE " + " AND ".join(drop_conditions)

    if dedup_key and dedup_order:
        key_cols = ", ".join(f'"{k}"' for k in dedup_key)
        inner = f"""SELECT *, ROW_NUMBER() OVER (PARTITION BY {key_cols} ORDER BY "{dedup_order}" DESC) AS _rn
FROM "{bronze_table}"{where_clause}"""
        sql = f"""INSERT INTO "{silver_table}" ({', '.join(target_cols)})
SELECT
{select_clause}
FROM ({inner}) sub
WHERE _rn = 1;"""
    else:
        sql = f"""INSERT INTO "{silver_table}" ({', '.join(target_cols)})
SELECT
{select_clause}
FROM "{bronze_table}"{where_clause};"""

    return sql


def _parse_json_response(raw: str) -> dict:
    """Extract JSON object from LLM response, handling markdown fences."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    log.warning("Failed to parse LLM JSON response, returning empty dict")
    return {}
