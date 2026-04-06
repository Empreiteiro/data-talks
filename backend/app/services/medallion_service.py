"""
Medallion Architecture service — Bronze / Silver / Gold layer generation.

Each source gets a persistent SQLite file at
  {data_files_dir}/{user_id}/medallion_{source_id}.db
The platform app DB (async SQLAlchemy) stores only metadata
(MedallionLayer, MedallionBuildLog); the medallion DB holds actual row data.
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MedallionLayer, MedallionBuildLog, Source
from app.llm.client import chat_completion
from app.scripts.ask_csv import _load_full_dataframe, _build_sample_profile, _format_profile

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid() -> str:
    return str(uuid.uuid4())


def _short_id(source_id: str) -> str:
    """First 8 chars of the source UUID (safe for table names)."""
    return source_id.replace("-", "")[:8]


def _medallion_db_path(data_files_dir: str, user_id: str, source_id: str) -> Path:
    return Path(data_files_dir) / user_id / f"medallion_{source_id}.db"


def _get_medallion_conn(data_files_dir: str, user_id: str, source_id: str) -> sqlite3.Connection:
    path = _medallion_db_path(data_files_dir, user_id, source_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(path))


def _row_hash(row: dict) -> str:
    raw = json.dumps(row, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()


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
# Bronze
# ---------------------------------------------------------------------------

async def generate_bronze(
    source: Source,
    user_id: str,
    agent_id: str,
    data_files_dir: str,
    db: AsyncSession,
) -> dict:
    """Create bronze table from raw source file. Returns layer dict."""
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

    # Build DDL: all columns as TEXT + metadata columns
    col_defs = [
        "_loaded_at TEXT",
        "_source_file TEXT",
        "_row_hash TEXT",
    ]
    for col in df.columns:
        safe_col = str(col).replace('"', '""')
        col_defs.append(f'"{safe_col}" TEXT')

    ddl = f'CREATE TABLE IF NOT EXISTS "{table_name}" (\n  ' + ",\n  ".join(col_defs) + "\n);"

    # Insert data
    conn = _get_medallion_conn(data_files_dir, user_id, source.id)
    try:
        conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
        conn.execute(ddl)

        now_str = datetime.utcnow().isoformat()
        source_file = Path(file_path_str).name

        placeholders = ", ".join(["?"] * (len(df.columns) + 3))
        insert_sql = f'INSERT INTO "{table_name}" VALUES ({placeholders})'

        rows_to_insert = []
        for _, row in df.iterrows():
            row_dict = row.to_dict()
            rh = _row_hash(row_dict)
            values = [now_str, source_file, rh] + [
                str(v) if pd.notna(v) else None for v in row.values
            ]
            rows_to_insert.append(values)

        conn.executemany(insert_sql, rows_to_insert)
        conn.commit()
        row_count = len(rows_to_insert)
    finally:
        conn.close()

    # Save layer metadata in app DB
    schema_config = {
        "columns": list(df.columns),
        "metadata_columns": ["_loaded_at", "_source_file", "_row_hash"],
    }

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
        action="apply",
        layer="bronze",
        applied_config=schema_config,
    )
    db.add(build_log)
    await db.flush()

    return _layer_to_dict(layer)


# ---------------------------------------------------------------------------
# Silver — Suggest
# ---------------------------------------------------------------------------

_SILVER_SYSTEM_PROMPT = """\
You are a data engineer. Analyze this raw data profile from a Bronze (raw staging) layer \
and suggest a Silver (cleaned) schema.

For each column, suggest:
1. **target_type**: Appropriate SQL data type (INTEGER, REAL, TEXT, DATE, TIMESTAMP, BOOLEAN)
2. **cast_expression**: SQL expression to transform from TEXT (e.g., `CAST(col AS INTEGER)`, `LOWER(TRIM(col))`)
3. **null_strategy**: One of DROP_ROW, FILL_DEFAULT, FILL_ZERO, KEEP_NULL
4. **null_default**: Default value when null_strategy is FILL_DEFAULT (optional)
5. **silver_name**: Cleaned snake_case column name

Also suggest deduplication if you detect a primary key candidate:
- **dedup_key**: list of column names forming the unique key
- **dedup_order_by**: column to ORDER BY DESC for keeping latest

Return ONLY valid JSON in this exact format:
{
  "columns": [
    {
      "source_column": "original_name",
      "silver_name": "clean_name",
      "target_type": "INTEGER",
      "cast_expression": "CAST(\\"original_name\\" AS INTEGER)",
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
    """Use LLM to suggest silver schema. Returns {suggestion, ddlPreview, transformPreview, buildLogId}."""
    # Get bronze layer
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.source_id == source.id,
            MedallionLayer.layer == "bronze",
            MedallionLayer.status == "ready",
        )
    )
    bronze = result.scalar_one_or_none()
    if not bronze:
        raise ValueError("Bronze layer must be built first")

    # Load sample data from medallion DB for profiling
    conn = _get_medallion_conn(data_files_dir, user_id, source.id)
    try:
        df = pd.read_sql_query(
            f'SELECT * FROM "{bronze.table_name}" LIMIT 1000',
            conn,
        )
    finally:
        conn.close()

    # Drop metadata columns for profiling
    data_cols = [c for c in df.columns if not c.startswith("_")]
    df_data = df[data_cols]

    profile = _build_sample_profile(df_data)
    profile_text = _format_profile(profile)

    user_msg = f"""Bronze table: {bronze.table_name}
Columns (all stored as TEXT): {', '.join(data_cols)}
Row count: {bronze.row_count}

Data profile:
{profile_text}

Sample rows (first 3):
{df_data.head(3).to_string(index=False)}
"""

    if feedback:
        user_msg += f"\n\nUser feedback on previous suggestion — please adjust accordingly:\n{feedback}"

    messages = [
        {"role": "system", "content": _SILVER_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw_content, usage, _trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)

    # Parse JSON from LLM response
    suggestion = _parse_json_response(raw_content)
    sid = _short_id(source.id)

    # Generate preview SQL
    ddl_preview = _build_silver_ddl(suggestion, sid)
    transform_preview = _build_silver_transform(suggestion, bronze.table_name, f"silver_{sid}")

    # Log
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
# Silver — Apply
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
    """Apply user-edited silver config. Returns layer dict."""
    # Get bronze
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.source_id == source.id,
            MedallionLayer.layer == "bronze",
            MedallionLayer.status == "ready",
        )
    )
    bronze = result.scalar_one_or_none()
    if not bronze:
        raise ValueError("Bronze layer must be built first")

    sid = _short_id(source.id)
    silver_table = f"silver_{sid}"
    ddl = _build_silver_ddl(config, sid)
    transform = _build_silver_transform(config, bronze.table_name, silver_table)

    # Execute on medallion DB
    conn = _get_medallion_conn(data_files_dir, user_id, source.id)
    try:
        conn.execute(f'DROP TABLE IF EXISTS "{silver_table}"')
        conn.execute(ddl)
        conn.execute(transform)
        conn.commit()
        cursor = conn.execute(f'SELECT COUNT(*) FROM "{silver_table}"')
        row_count = cursor.fetchone()[0]
    except Exception as e:
        conn.rollback()
        # Log error
        err_log = MedallionBuildLog(
            id=_uid(), source_id=source.id, user_id=user_id,
            action="error", layer="silver", error_message=str(e),
        )
        db.add(err_log)
        await db.flush()
        raise
    finally:
        conn.close()

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
        row_count=row_count,
    )
    db.add(layer)

    # Update build log
    apply_log = MedallionBuildLog(
        id=_uid(),
        layer_id=layer.id,
        source_id=source.id,
        user_id=user_id,
        action="apply",
        layer="silver",
        applied_config=config,
    )
    db.add(apply_log)
    await db.flush()

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
Use standard SQL (SQLite compatible). Include GROUP BY for aggregates.
4. **dimensions**: list of grouping columns
5. **measures**: list of {column, agg_func, alias} objects

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "name": "monthly_revenue",
      "description": "Monthly revenue totals",
      "sql": "SELECT strftime('%Y-%m', created_at) AS month, SUM(revenue) AS total_revenue ...",
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
) -> dict:
    """Use LLM to suggest gold aggregate tables. Returns {suggestions, buildLogId}."""
    result = await db.execute(
        select(MedallionLayer).where(
            MedallionLayer.source_id == source.id,
            MedallionLayer.layer == "silver",
            MedallionLayer.status == "ready",
        )
    )
    silver = result.scalar_one_or_none()
    if not silver:
        raise ValueError("Silver layer must be built first")

    # Get silver schema from medallion DB
    conn = _get_medallion_conn(data_files_dir, user_id, source.id)
    try:
        cursor = conn.execute(f'PRAGMA table_info("{silver.table_name}")')
        columns = [(row[1], row[2]) for row in cursor.fetchall()]
        df_sample = pd.read_sql_query(
            f'SELECT * FROM "{silver.table_name}" LIMIT 5',
            conn,
        )
    finally:
        conn.close()

    col_desc = "\n".join(f"- {name} ({dtype})" for name, dtype in columns)
    sample_text = df_sample.to_string(index=False)

    user_msg = f"""Silver table: {silver.table_name}
Row count: {silver.row_count}

Columns:
{col_desc}

Sample rows (first 5):
{sample_text}
"""

    if feedback:
        user_msg += f"\n\nUser feedback on previous suggestions — please adjust accordingly:\n{feedback}"

    messages = [
        {"role": "system", "content": _GOLD_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    raw_content, usage, _trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
    parsed = _parse_json_response(raw_content)
    suggestions = parsed.get("suggestions", [])

    # Generate DDL previews
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
# Gold — Apply
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
    """Materialize selected gold aggregate tables. Returns list of layer dicts."""
    sid = _short_id(source.id)
    layers = []

    conn = _get_medallion_conn(data_files_dir, user_id, source.id)
    try:
        for tbl in selected_tables:
            name = tbl.get("name", "agg")
            sql = tbl.get("sql", "")
            gold_table = f"gold_{sid}_{name}"

            create_sql = f'CREATE TABLE IF NOT EXISTS "{gold_table}" AS\n{sql};'

            try:
                conn.execute(f'DROP TABLE IF EXISTS "{gold_table}"')
                conn.execute(create_sql)
                conn.commit()
                cursor = conn.execute(f'SELECT COUNT(*) FROM "{gold_table}"')
                row_count = cursor.fetchone()[0]
            except Exception as e:
                conn.rollback()
                err_log = MedallionBuildLog(
                    id=_uid(), source_id=source.id, user_id=user_id,
                    action="error", layer="gold", error_message=f"{gold_table}: {e}",
                )
                db.add(err_log)
                continue

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
                row_count=row_count,
            )
            db.add(layer)

            apply_log = MedallionBuildLog(
                id=_uid(),
                layer_id=layer.id,
                source_id=source.id,
                user_id=user_id,
                action="apply",
                layer="gold",
                applied_config=tbl,
            )
            db.add(apply_log)
            layers.append(_layer_to_dict(layer))

    finally:
        conn.close()

    await db.flush()
    return layers


# ---------------------------------------------------------------------------
# Query helpers (for ask_csv query routing)
# ---------------------------------------------------------------------------

def get_medallion_connection(
    data_files_dir: str, user_id: str, source_id: str
) -> sqlite3.Connection | None:
    """Return a connection to the medallion DB if it exists, else None."""
    path = _medallion_db_path(data_files_dir, user_id, source_id)
    if not path.exists():
        return None
    return sqlite3.connect(str(path))


def list_medallion_tables(conn: sqlite3.Connection) -> dict[str, list[tuple[str, str]]]:
    """Return {table_name: [(col_name, col_type), ...]} for all medallion tables."""
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {}
    for (tname,) in cursor.fetchall():
        cols = conn.execute(f'PRAGMA table_info("{tname}")')
        tables[tname] = [(r[1], r[2]) for r in cols.fetchall()]
    return tables


# ---------------------------------------------------------------------------
# SQL Generation helpers
# ---------------------------------------------------------------------------

def _build_silver_ddl(config: dict, short_id: str) -> str:
    """Generate CREATE TABLE for silver layer from config."""
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


def _build_silver_transform(config: dict, bronze_table: str, silver_table: str) -> str:
    """Generate INSERT INTO ... SELECT for silver layer from config."""
    columns = config.get("columns", [])
    dedup_key = config.get("dedup_key", [])
    dedup_order = config.get("dedup_order_by")

    select_exprs = []
    target_cols = []
    for col in columns:
        expr = col.get("cast_expression", f'"{col.get("source_column", "")}"')
        alias = col.get("silver_name", col.get("source_column", ""))
        safe_alias = alias.replace('"', '""')
        target_cols.append(f'"{safe_alias}"')

        # Apply null strategy
        null_strategy = col.get("null_strategy", "KEEP_NULL")
        null_default = col.get("null_default")

        if null_strategy == "FILL_ZERO":
            expr = f"COALESCE({expr}, 0)"
        elif null_strategy == "FILL_DEFAULT" and null_default is not None:
            expr = f"COALESCE({expr}, '{null_default}')"
        elif null_strategy == "DROP_ROW":
            pass  # handled in WHERE clause

        select_exprs.append(f"  {expr} AS \"{safe_alias}\"")

    select_clause = ",\n".join(select_exprs)

    # WHERE clause for DROP_ROW columns
    drop_conditions = []
    for col in columns:
        if col.get("null_strategy") == "DROP_ROW":
            src = col.get("source_column", "")
            drop_conditions.append(f'"{src}" IS NOT NULL')

    where_clause = ""
    if drop_conditions:
        where_clause = "\nWHERE " + " AND ".join(drop_conditions)

    # Deduplication via subquery
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
    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last fence lines
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    # Find JSON object boundaries
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    log.warning("Failed to parse LLM JSON response, returning empty dict")
    return {}
