"""LLM-based suggestion of relationships (foreign-key style joins)
between SQL sources / tables.

Companion to the heuristic `suggest_source_relationships` in
`sql_utils.py`. The heuristic only finds shared column names across
DIFFERENT sources; this module asks the LLM to look at table + column
names and propose semantically meaningful joins (including same-source
joins like `orders.user_id → users.id`).

Output goes through the same `validate_source_relationships` pipeline
so a hallucinated table or column never reaches the user.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.llm.client import chat_completion
from app.scripts.sql_utils import (
    build_source_table_map,
    relationship_key,
    validate_source_relationships,
)


# Caps to keep the prompt small enough for cheap models. With a typical
# warehouse of ~50 tables × 20 columns the raw JSON is ~30k chars,
# which is fine for any modern model. Past these caps we truncate; the
# user can still add extras manually in the relationships screen.
_MAX_TABLES_PER_SOURCE = 60
_MAX_COLUMNS_PER_TABLE = 40
_MAX_SUGGESTIONS = 25


def _summarize_sources(source_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact source/table/column listing for the prompt."""
    summary: list[dict[str, Any]] = []
    for source in source_rows:
        tables = []
        for table in (source.get("table_infos") or [])[:_MAX_TABLES_PER_SOURCE]:
            cols = [c for c in (table.get("columns") or []) if c][
                :_MAX_COLUMNS_PER_TABLE
            ]
            tables.append({"table": table.get("table"), "columns": cols})
        summary.append(
            {
                "id": source.get("id"),
                "name": source.get("name"),
                "tables": tables,
            }
        )
    return summary


def _build_messages(
    source_summary: list[dict[str, Any]],
    existing: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system = (
        "You are a senior data engineer. You analyse SQL schemas and propose "
        "foreign-key style relationships between tables. You ONLY use table "
        "and column names that appear verbatim in the input. You output "
        "strict JSON, never prose."
    )
    rules = (
        "Rules:\n"
        "- Suggest relationships likely to be foreign keys based on naming "
        "patterns (e.g. user_id → users.id), shared identifier columns, or "
        "obvious entity links (orders.customer_id → customers.id).\n"
        "- Both same-source (different tables in one source) and cross-source "
        "joins are allowed.\n"
        "- Never invent table or column names. Use exact names as listed.\n"
        "- Skip relationships already listed under EXISTING.\n"
        "- Order from highest to lowest confidence.\n"
        f"- Return at most {_MAX_SUGGESTIONS} relationships.\n"
        "- Each `reason` must be under 120 characters."
    )
    schema = (
        'Output JSON shape (and ONLY this — no markdown, no commentary):\n'
        '{\n'
        '  "relationships": [\n'
        '    {\n'
        '      "leftSourceId": "<source id from input>",\n'
        '      "leftTable": "<table name>",\n'
        '      "leftColumn": "<column name>",\n'
        '      "rightSourceId": "<source id from input>",\n'
        '      "rightTable": "<table name>",\n'
        '      "rightColumn": "<column name>",\n'
        '      "reason": "<short why>"\n'
        '    }\n'
        '  ]\n'
        '}'
    )
    user = (
        f"SOURCES:\n{json.dumps(source_summary, ensure_ascii=False, indent=2)}\n\n"
        f"EXISTING (do not repeat):\n{json.dumps(existing, ensure_ascii=False, indent=2)}\n\n"
        f"{rules}\n\n{schema}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def _parse_relationships_json(content: str) -> list[dict[str, Any]]:
    """Extract `relationships` list from the LLM response. Tolerates
    fenced code blocks and trailing prose."""
    if not content:
        return []
    text = content.strip()
    m = _FENCE.search(text)
    if m:
        text = m.group(1).strip()
    # Find the first '{' and the last '}' — handles models that
    # prefix/suffix the JSON with stray text despite the prompt.
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []
    rels = parsed.get("relationships") if isinstance(parsed, dict) else None
    return rels if isinstance(rels, list) else []


async def suggest_source_relationships_llm(
    source_rows: list[dict[str, Any]],
    existing_relationships: list[dict[str, Any]] | None = None,
    llm_overrides: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Ask the LLM to suggest relationships between the given SQL sources.

    Returns a list of validated relationship dicts. Each dict has the
    six standard fields (`leftSourceId`, `leftTable`, `leftColumn`,
    `rightSourceId`, `rightTable`, `rightColumn`) plus an optional
    `reason` string explaining the LLM's rationale.

    Suggestions whose canonical key matches an entry in
    `existing_relationships` are filtered out before returning.

    Returns `[]` on any LLM/parsing error rather than raising — the
    caller treats no suggestions as a benign empty state.
    """
    # Need at least 2 tables across all sources for any relationship to exist.
    source_map = build_source_table_map(source_rows)
    table_count = sum(len(s["tables"]) for s in source_map.values())
    if table_count < 2:
        return []

    source_summary = _summarize_sources(source_rows)
    existing = list(existing_relationships or [])

    messages = _build_messages(source_summary, existing)
    try:
        content, _usage, _trace = await chat_completion(
            messages=messages,
            max_tokens=2048,
            llm_overrides=llm_overrides,
        )
    except Exception:  # noqa: BLE001 - LLM errors degrade to "no suggestions"
        return []

    raw = _parse_relationships_json(content)
    if not raw:
        return []

    # Capture LLM-provided reasons keyed by canonical key so we can
    # re-attach them after validation (which only keeps the six core
    # fields).
    reasons: dict[str, str] = {}
    cleaned: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        core = {
            k: str(item.get(k) or "").strip()
            for k in (
                "leftSourceId",
                "leftTable",
                "leftColumn",
                "rightSourceId",
                "rightTable",
                "rightColumn",
            )
        }
        if not all(core.values()):
            continue
        cleaned.append(core)
        reason = item.get("reason")
        if isinstance(reason, str) and reason.strip():
            reasons[relationship_key(core)] = reason.strip()[:200]

    try:
        validated = validate_source_relationships(source_rows, cleaned)
    except ValueError:
        # If even one entry is bad the heuristic helper raises; we'd
        # rather drop bad entries one at a time so a single hallucination
        # doesn't blank the whole list.
        validated = []
        for entry in cleaned:
            try:
                ok = validate_source_relationships(source_rows, [entry])
            except ValueError:
                continue
            validated.extend(ok)

    existing_keys = {relationship_key(rel) for rel in existing}
    out: list[dict[str, Any]] = []
    for rel in validated:
        key = relationship_key(rel)
        if key in existing_keys:
            continue
        if reasons.get(key):
            rel = {**rel, "reason": reasons[key]}
        out.append(rel)
        if len(out) >= _MAX_SUGGESTIONS:
            break
    return out
