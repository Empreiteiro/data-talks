"""Answer questions across multiple SQL sources by materializing them into SQLite."""
from __future__ import annotations

import asyncio
from pathlib import Path
import sqlite3
from typing import Any

import pandas as pd

from app.scripts.ask_sql import _extract_followups, _parse_llm_json

MAX_SQLITE_ROWS_FETCH = 500


def _safe_alias(source_id: str, table_name: str) -> str:
    suffix = (source_id or "source").replace("-", "_")[-8:]
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in table_name).strip("_") or "table"
    return f"src_{suffix}_{cleaned}".lower()


def _materialize_sources_to_sqlite(
    sources: list[dict[str, Any]],
) -> tuple[sqlite3.Connection, list[dict[str, Any]]]:
    from sqlalchemy import create_engine

    sqlite_conn = sqlite3.connect(":memory:")
    sqlite_conn.row_factory = sqlite3.Row
    aliases: list[dict[str, Any]] = []

    try:
        for source in sources:
            connection_string = str(source.get("connectionString") or "").strip()
            source_id = str(source.get("id") or "")
            source_name = str(source.get("name") or source_id)
            for table_info in source.get("table_infos") or []:
                table_name = str(table_info.get("table") or "").strip()
                if not connection_string or not table_name:
                    continue

                engine = create_engine(connection_string)
                try:
                    preparer = engine.dialect.identifier_preparer
                    qualified_name = ".".join(
                        preparer.quote(part)
                        for part in table_name.split(".")
                        if part.strip()
                    )
                    query = f"SELECT * FROM {qualified_name}"
                    df = pd.read_sql_query(query, engine)
                finally:
                    engine.dispose()

                alias = _safe_alias(source_id, table_name)
                df.to_sql(alias, sqlite_conn, index=False, if_exists="replace")
                aliases.append({
                    "sourceId": source_id,
                    "sourceName": source_name,
                    "table": table_name,
                    "alias": alias,
                    "columns": [str(col) for col in df.columns],
                })
        return sqlite_conn, aliases
    except Exception:
        sqlite_conn.close()
        raise


def _build_schema_text(table_aliases: list[dict[str, Any]]) -> str:
    lines = []
    for item in table_aliases:
        lines.append(
            f'Source "{item["sourceName"]}" table {item["table"]} is available as SQLite table '
            f'{item["alias"]} with columns {item["columns"]}'
        )
    return "\n".join(lines)


def _build_relationship_text(
    relationships: list[dict[str, str]],
    alias_map: dict[tuple[str, str], str],
) -> str:
    lines = []
    for relationship in relationships:
        left_alias = alias_map.get((relationship["leftSourceId"], relationship["leftTable"]))
        right_alias = alias_map.get((relationship["rightSourceId"], relationship["rightTable"]))
        if not left_alias or not right_alias:
            continue
        lines.append(
            f'{left_alias}."{relationship["leftColumn"]}" = {right_alias}."{relationship["rightColumn"]}"'
        )
    return "\n".join(lines)


def _run_sqlite_query(conn: sqlite3.Connection, query: str) -> list[dict[str, Any]]:
    q = (query or "").strip().upper()
    if not q.startswith("SELECT"):
        raise ValueError("Only SELECT queries are allowed")
    for forbidden in ("DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "TRUNCATE"):
        if forbidden in q:
            raise ValueError("Only SELECT queries are allowed")

    rows = conn.execute(query).fetchmany(MAX_SQLITE_ROWS_FETCH)
    return [dict(row) for row in rows]


async def ask_sql_multi_source(
    sources: list[dict[str, Any]],
    relationships: list[dict[str, str]],
    question: str,
    agent_description: str = "",
    llm_overrides: dict | None = None,
    history: list[dict] | None = None,
    channel: str = "workspace",
) -> dict[str, Any]:
    from app.llm.charting import build_chart_input
    from app.llm.client import chat_completion
    from app.llm.elaborate import elaborate_answer_with_results
    from app.llm.followups import refine_followup_questions
    from app.llm.logs import record_log

    loop = asyncio.get_event_loop()
    sqlite_conn, table_aliases = await loop.run_in_executor(None, lambda: _materialize_sources_to_sqlite(sources))
    try:
        alias_map = {
            (item["sourceId"], item["table"]): item["alias"]
            for item in table_aliases
        }
        schema_text = _build_schema_text(table_aliases)
        relationship_text = _build_relationship_text(relationships, alias_map)
        system = (
            "You are an assistant that answers questions about multiple SQL databases. "
            "The system materialized each original source table into an in-memory SQLite database. "
            "When the question requires precise filtering or aggregation, you MUST provide a SQLite-compatible "
            "SELECT query inside a fenced ```sql``` block using the provided SQLite table aliases. "
            "Use the documented relationship clauses to join tables when needed. "
            "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
            "sqlQuery (string or null). "
            "Any suggested follow-up questions must be answerable using only the available schema and relationships. "
            "Do not invent fields, joins, dimensions, or metrics outside the provided schema. "
            "Do not include any extra text outside the JSON."
        )
        if agent_description:
            system += f"\nContext: {agent_description}"

        messages = [{"role": "system", "content": system}]
        if history:
            for turn in history[-5:]:
                messages.append({"role": "user", "content": turn["question"]})
                messages.append({"role": "assistant", "content": turn["answer"]})
        messages.append({
            "role": "user",
            "content": (
                f"Schema:\n{schema_text}\n\n"
                f"Relationships:\n{relationship_text or 'No explicit relationships available'}\n\n"
                f"Question: {question}"
            ),
        })

        raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
        await record_log(
            action="pergunta",
            provider=usage.get("provider", ""),
            model=usage.get("model", ""),
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            source="SQL multi-source",
            channel=channel,
            trace=trace,
        )

        parsed = _parse_llm_json(raw_answer)
        answer = parsed["answer"]
        follow_up = parsed["followUpQuestions"]
        sql_query = parsed.get("sqlQuery") or ""

        chart_input = None
        if sql_query and sql_query.upper().startswith("SELECT"):
            try:
                rows = await loop.run_in_executor(None, lambda: _run_sqlite_query(sqlite_conn, sql_query))
                chart_input = build_chart_input(rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=rows,
                    agent_description=agent_description,
                    source_name="SQL multi-source",
                    schema_text=f"{schema_text}\nRelationships:\n{relationship_text}",
                    llm_overrides=llm_overrides,
                    channel=channel,
                )
                answer = elaborated["answer"]
                follow_up = elaborated["followUpQuestions"] or follow_up
            except Exception as exc:
                answer = f"{answer}\n\n*Erro ao executar a consulta SQL multi-source: {exc}*"

        if not parsed["parsed_ok"]:
            if not answer:
                answer = raw_answer
            if not follow_up:
                follow_up = _extract_followups(raw_answer)

        follow_up = await refine_followup_questions(
            question=question,
            candidate_questions=follow_up,
            schema_text=f"{schema_text}\nRelationships:\n{relationship_text}",
            llm_overrides=llm_overrides,
        )
        return {
            "answer": answer,
            "imageUrl": None,
            "followUpQuestions": follow_up,
            "chartInput": chart_input,
        }
    finally:
        sqlite_conn.close()
