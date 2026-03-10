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

    sqlite_conn = sqlite3.connect(":memory:", check_same_thread=False)
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
    """Build a clear schema description: table names, columns, and SQLite aliases."""
    lines = []
    for item in table_aliases:
        cols_str = ", ".join(item["columns"]) if item.get("columns") else "(no columns)"
        lines.append(
            f'- Tabela "{item["table"]}" (fonte: {item["sourceName"]})\n'
            f'  Colunas: {cols_str}\n'
            f'  Alias no SQL: {item["alias"]}'
        )
    return "\n\n".join(lines)


def _build_relationship_text(
    relationships: list[dict[str, str]],
    alias_map: dict[tuple[str, str], str],
) -> tuple[str, str]:
    """Build human-readable relationship description and SQL join conditions."""
    human_lines = []
    sql_lines = []
    for relationship in relationships:
        left_alias = alias_map.get((relationship["leftSourceId"], relationship["leftTable"]))
        right_alias = alias_map.get((relationship["rightSourceId"], relationship["rightTable"]))
        if not left_alias or not right_alias:
            continue
        human_lines.append(
            f'- {relationship["leftTable"]}.{relationship["leftColumn"]} -> '
            f'{relationship["rightTable"]}.{relationship["rightColumn"]}'
        )
        sql_lines.append(
            f'{left_alias}."{relationship["leftColumn"]}" = {right_alias}."{relationship["rightColumn"]}"'
        )
    human_text = "\n".join(human_lines) if human_lines else "Nenhuma conexão configurada."
    sql_text = "\n".join(sql_lines) if sql_lines else ""
    return human_text, sql_text


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
    sql_mode: bool = False,
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
        relationship_human, relationship_sql = _build_relationship_text(relationships, alias_map)
        system = (
            "You are an assistant that answers questions about multiple SQL databases. "
            "The system materialized each original source table into an in-memory SQLite database. "
            "You receive: (1) table names and their columns, (2) explicit connections (relationships) if configured. "
            "When explicit relationships exist, use them for JOINs. "
            "When no explicit relationships exist, infer JOINs from column names: e.g. orders.customer_id = customers.id, "
            "order_items.order_id = orders.id, order_items.product_id = products.id. "
            "Use JOINs to answer questions that span multiple tables (e.g. customers with orders, products in orders). "
            "You MUST provide a SQLite-compatible SELECT query in a fenced ```sql``` block using the provided table aliases. "
            "Return ONLY valid JSON with keys: answer (string), followUpQuestions (array of strings), "
            "sqlQuery (string or null). "
            "Do not invent tables or columns outside the provided schema. "
            "Do not include any extra text outside the JSON."
        )
        if agent_description:
            system += f"\nContext: {agent_description}"

        user_content_parts = [
            "TABELAS E COLUNAS:\n",
            schema_text,
        ]
        if relationship_sql:
            user_content_parts.extend([
                "\n\nCONEXÕES (SQL Links):\n",
                relationship_human,
                "\n\nCláusulas JOIN:\n",
                relationship_sql,
            ])
        else:
            user_content_parts.append(
                "\n\n(Sem conexões explícitas. Infira JOINs por nomes de colunas: customer_id->customers.id, "
                "order_id->orders.id, product_id->products.id, etc.)"
            )
        user_content_parts.extend(["\n\nPERGUNTA: ", question])

        messages = [{"role": "system", "content": system}]
        if history:
            for turn in history[-5:]:
                messages.append({"role": "user", "content": turn["question"]})
                messages.append({"role": "assistant", "content": turn["answer"]})
        messages.append({
            "role": "user",
            "content": "".join(user_content_parts),
        })

        raw_answer, usage, trace = await chat_completion(messages, max_tokens=2048, llm_overrides=llm_overrides)
        trace["stage"] = "pergunta_main"
        trace["source_type"] = "sql_multi"
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
        if sql_mode and sql_query:
            answer = sql_query
        elif sql_query and sql_query.upper().startswith("SELECT"):
            try:
                rows = await loop.run_in_executor(None, lambda: _run_sqlite_query(sqlite_conn, sql_query))
                chart_input = build_chart_input(rows, schema_text)
                elaborated = await elaborate_answer_with_results(
                    question=question,
                    query_results=rows,
                    agent_description=agent_description,
                    source_name="SQL multi-source",
                    schema_text=f"{schema_text}\n\nConexões:\n{relationship_human}",
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
            schema_text=f"{schema_text}\n\nConexões:\n{relationship_human}",
            llm_overrides=llm_overrides,
            channel=channel,
        )
        return {
            "answer": answer,
            "imageUrl": None,
            "followUpQuestions": follow_up,
            "chartInput": chart_input,
        }
    finally:
        sqlite_conn.close()
