"""
CDP (Customer Data Platform) service — AI-assisted identity resolution,
enrichment, and segmentation.

All operations generate SQL suggestions (stored in workspace_config)
but do NOT execute SQL on client databases.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Source
from app.llm.client import chat_completion

log = logging.getLogger(__name__)

LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


async def suggest_identity_resolution(
    agent: Agent,
    sources: list[Source],
    db: AsyncSession,
    llm_overrides: dict | None = None,
    language: str | None = None,
) -> dict:
    """Analyze multiple sources and suggest how to unify customer records."""
    source_schemas = []
    for src in sources:
        meta = src.metadata_ or {}
        columns = meta.get("columns", [])
        profile = meta.get("sample_profile", {})
        col_details = []
        for col in columns:
            info = profile.get("columns", {}).get(col, {})
            top = info.get("top_values", {})
            col_details.append(f"  - {col} (type={info.get('type', '?')}, sample={list(top.keys())[:2]})")
        source_schemas.append(f"Source: {src.name} ({src.type})\nColumns:\n" + "\n".join(col_details))

    schema_text = "\n\n".join(source_schemas)
    lang = LANGUAGE_NAMES.get(language or "", "")
    lang_inst = f"Write ALL text in {lang}. " if lang else ""

    system = (
        "You are a data engineer specializing in Customer Data Platforms. "
        "Given multiple data sources, suggest how to unify customer records (identity resolution).\n\n"
        f"{lang_inst}"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "join_key": "email",\n'
        '  "join_strategy": "Description of how to join sources",\n'
        '  "source_mappings": [\n'
        '    {"source": "source_name", "key_column": "email", "extra_keys": ["phone"]}\n'
        "  ],\n"
        '  "silver_sql": "CREATE TABLE unified_customers AS SELECT ... FROM ... JOIN ...",\n'
        '  "explanation": "Brief explanation"\n'
        "}"
    )

    raw, usage, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": schema_text}],
        max_tokens=2048, llm_overrides=llm_overrides,
    )
    return _parse_json(raw)


async def suggest_enrichment(
    agent: Agent,
    unified_schema: dict,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    language: str | None = None,
) -> dict:
    """Suggest customer metrics to calculate from unified data."""
    lang = LANGUAGE_NAMES.get(language or "", "")
    lang_inst = f"Write ALL text in {lang}. " if lang else ""

    system = (
        "You are a data analyst specializing in customer analytics. "
        "Given a unified customer table schema, suggest enrichment metrics.\n\n"
        f"{lang_inst}"
        "Suggest 5-8 metrics. Return ONLY valid JSON:\n"
        "{\n"
        '  "metrics": [\n'
        '    {"name": "lifetime_value", "sql_expression": "SUM(amount)", "description": "Total revenue per customer"},\n'
        '    {"name": "purchase_frequency", "sql_expression": "COUNT(*)", "description": "Number of purchases"}\n'
        "  ],\n"
        '  "gold_sql": "CREATE TABLE enriched_customers AS SELECT customer_id, ... FROM unified_customers GROUP BY customer_id",\n'
        '  "explanation": "Brief explanation"\n'
        "}"
    )

    user_msg = f"Unified customer schema:\n{json.dumps(unified_schema, indent=2, default=str)}"

    raw, usage, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        max_tokens=2048, llm_overrides=llm_overrides,
    )
    return _parse_json(raw)


async def suggest_segmentation(
    agent: Agent,
    enriched_schema: dict,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    language: str | None = None,
) -> dict:
    """Suggest customer segmentation rules from enriched data."""
    lang = LANGUAGE_NAMES.get(language or "", "")
    lang_inst = f"Write ALL text in {lang}. " if lang else ""

    system = (
        "You are a marketing data analyst. "
        "Given enriched customer data with metrics, suggest segmentation rules.\n\n"
        f"{lang_inst}"
        "Suggest 4-6 segments. Return ONLY valid JSON:\n"
        "{\n"
        '  "segments": [\n'
        '    {"name": "VIP", "description": "High-value customers", "rule_sql": "lifetime_value > 10000 AND purchase_frequency > 5"},\n'
        '    {"name": "At Risk", "description": "Previously active, now dormant", "rule_sql": "days_since_last > 90 AND purchase_frequency > 3"}\n'
        "  ],\n"
        '  "segment_sql": "CREATE TABLE customer_segments AS SELECT *, CASE WHEN ... END AS segment FROM enriched_customers",\n'
        '  "explanation": "Brief explanation"\n'
        "}"
    )

    user_msg = f"Enriched customer schema:\n{json.dumps(enriched_schema, indent=2, default=str)}"

    raw, usage, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        max_tokens=2048, llm_overrides=llm_overrides,
    )
    return _parse_json(raw)


def _parse_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].strip() == "```": lines = lines[:-1]
        text = "\n".join(lines)
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    return {}
