"""Shared utilities for SQL-based ask scripts."""
import re
from typing import Any


def extract_sql_from_field(s: str) -> str:
    """Extract SQL from sqlQuery field, stripping ```sql ... ``` if present."""
    s = (s or "").strip()
    if not s:
        return ""
    m = re.search(r"```(?:sql)?\s*([\s\S]*?)```", s, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return s


def list_sql_tables_sync(connection_string: str) -> list[dict[str, Any]]:
    """List reachable SQL tables and columns for the provided connection string."""
    from sqlalchemy import create_engine, inspect

    engine = create_engine(connection_string)
    try:
        inspector = inspect(engine)
        dialect = engine.dialect.name
        default_schema = getattr(inspector, "default_schema_name", None)
        tables: list[dict[str, Any]] = []

        if dialect == "postgresql":
            schema_names = [
                schema
                for schema in inspector.get_schema_names()
                if schema not in {"information_schema", "pg_catalog"}
                and not schema.startswith("pg_toast")
            ]
            for schema in schema_names:
                for table_name in inspector.get_table_names(schema=schema):
                    columns = [str(col.get("name", "")) for col in inspector.get_columns(table_name, schema=schema)]
                    display_name = table_name if schema == default_schema else f"{schema}.{table_name}"
                    tables.append({
                        "id": display_name,
                        "name": display_name,
                        "columns": [col for col in columns if col],
                    })
        else:
            for table_name in inspector.get_table_names():
                columns = [str(col.get("name", "")) for col in inspector.get_columns(table_name)]
                tables.append({
                    "id": table_name,
                    "name": table_name,
                    "columns": [col for col in columns if col],
                })

        tables.sort(key=lambda item: item["name"].lower())
        return tables
    finally:
        engine.dispose()


def normalize_table_infos(table_infos: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalize metadata table info keys used across SQL and BigQuery sources."""
    normalized: list[dict[str, Any]] = []
    for item in table_infos or []:
        table_name = str(item.get("table") or item.get("table_name") or "").strip()
        if not table_name:
            continue
        columns = [
            str(column).strip()
            for column in (item.get("columns") or [])
            if str(column).strip()
        ]
        normalized.append({
            "table": table_name,
            "columns": columns,
            "preview_rows": item.get("preview_rows") or [],
        })
    return normalized


def build_source_table_map(source_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index SQL source metadata for validation and relationship suggestions."""
    source_map: dict[str, dict[str, Any]] = {}
    for source in source_rows:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        table_infos = normalize_table_infos(source.get("table_infos"))
        table_map = {
            table_info["table"]: {
                "table": table_info["table"],
                "columns": table_info["columns"],
                "preview_rows": table_info["preview_rows"],
            }
            for table_info in table_infos
        }
        source_map[source_id] = {
            "id": source_id,
            "name": source.get("name") or source_id,
            "connection_string": source.get("connection_string") or "",
            "table_infos": table_infos,
            "tables": table_map,
        }
    return source_map


def validate_source_relationships(
    source_rows: list[dict[str, Any]],
    relationships: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    """Validate configured relationships against source/table/column metadata."""
    source_map = build_source_table_map(source_rows)
    validated: list[dict[str, str]] = []
    seen_keys: set[tuple[str, str, str, str, str, str]] = set()

    for raw in relationships or []:
        left_source_id = str(raw.get("leftSourceId") or "").strip()
        left_table = str(raw.get("leftTable") or "").strip()
        left_column = str(raw.get("leftColumn") or "").strip()
        right_source_id = str(raw.get("rightSourceId") or "").strip()
        right_table = str(raw.get("rightTable") or "").strip()
        right_column = str(raw.get("rightColumn") or "").strip()

        values = [
            left_source_id,
            left_table,
            left_column,
            right_source_id,
            right_table,
            right_column,
        ]
        if not all(values):
            raise ValueError("Each relationship must include source, table, and column on both sides")
        if left_source_id == right_source_id and left_table == right_table and left_column == right_column:
            raise ValueError("Relationship cannot point to the same source column on both sides")

        left_source = source_map.get(left_source_id)
        right_source = source_map.get(right_source_id)
        if not left_source or not right_source:
            raise ValueError("Relationship references an unknown SQL source")

        left_table_info = left_source["tables"].get(left_table)
        right_table_info = right_source["tables"].get(right_table)
        if not left_table_info or not right_table_info:
            raise ValueError("Relationship references an unknown SQL table")

        if left_column not in left_table_info["columns"] or right_column not in right_table_info["columns"]:
            raise ValueError("Relationship references an unknown SQL column")

        normalized = {
            "leftSourceId": left_source_id,
            "leftTable": left_table,
            "leftColumn": left_column,
            "rightSourceId": right_source_id,
            "rightTable": right_table,
            "rightColumn": right_column,
        }
        dedupe_key = tuple(normalized.values())
        reverse_key = (
            normalized["rightSourceId"],
            normalized["rightTable"],
            normalized["rightColumn"],
            normalized["leftSourceId"],
            normalized["leftTable"],
            normalized["leftColumn"],
        )
        if dedupe_key in seen_keys or reverse_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        validated.append(normalized)

    return validated


def suggest_source_relationships(source_rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Suggest relationships when sources share a column name."""
    suggestions: list[dict[str, str]] = []
    source_map = build_source_table_map(source_rows)
    ordered_sources = list(source_map.values())

    for index, left_source in enumerate(ordered_sources):
        for right_source in ordered_sources[index + 1 :]:
            for left_table in left_source["table_infos"]:
                left_columns = {column.lower(): column for column in left_table["columns"]}
                if not left_columns:
                    continue
                for right_table in right_source["table_infos"]:
                    right_columns = {column.lower(): column for column in right_table["columns"]}
                    for shared_key in sorted(set(left_columns).intersection(right_columns)):
                        suggestions.append({
                            "leftSourceId": left_source["id"],
                            "leftTable": left_table["table"],
                            "leftColumn": left_columns[shared_key],
                            "rightSourceId": right_source["id"],
                            "rightTable": right_table["table"],
                            "rightColumn": right_columns[shared_key],
                        })

    return validate_source_relationships(source_rows, suggestions)
