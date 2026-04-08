"""
ETL Pipeline service — AI-assisted pipeline definition, transforms, and lineage.

Pipelines are stored as workspace_config on the Agent model.
All SQL is suggestion-only — not executed on client databases.
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


async def suggest_pipeline(
    agent: Agent,
    sources: list[Source],
    description: str,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    language: str | None = None,
) -> dict:
    """AI suggests an ETL pipeline based on available sources and user description."""
    source_info = []
    for src in sources:
        meta = src.metadata_ or {}
        columns = meta.get("columns", [])
        source_info.append(f"Source: {src.name} ({src.type}), columns: {', '.join(columns[:20])}")

    schema_text = "\n".join(source_info)
    lang = LANGUAGE_NAMES.get(language or "", "")
    lang_inst = f"Write ALL text in {lang}. " if lang else ""

    system = (
        "You are a data engineer. Design an ETL pipeline based on the available sources "
        "and the user's description.\n\n"
        f"{lang_inst}"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "name": "pipeline_name",\n'
        '  "description": "What this pipeline does",\n'
        '  "steps": [\n'
        '    {\n'
        '      "id": "step1",\n'
        '      "name": "Extract raw data",\n'
        '      "type": "extract",\n'
        '      "source": "source_name",\n'
        '      "sql": "SELECT * FROM ...",\n'
        '      "description": "Load raw data from source"\n'
        "    },\n"
        '    {\n'
        '      "id": "step2",\n'
        '      "name": "Clean and transform",\n'
        '      "type": "transform",\n'
        '      "depends_on": ["step1"],\n'
        '      "sql": "SELECT CAST(...) AS ..., TRIM(...) FROM step1_output ...",\n'
        '      "description": "Clean data types and names"\n'
        "    },\n"
        '    {\n'
        '      "id": "step3",\n'
        '      "name": "Create aggregates",\n'
        '      "type": "load",\n'
        '      "depends_on": ["step2"],\n'
        '      "sql": "CREATE TABLE output AS SELECT ... GROUP BY ...",\n'
        '      "description": "Final aggregated output"\n'
        "    }\n"
        "  ],\n"
        '  "schedule": "daily",\n'
        '  "explanation": "Brief explanation of the pipeline design"\n'
        "}"
    )

    user_msg = f"Available sources:\n{schema_text}\n\nPipeline goal: {description}"

    raw, usage, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        max_tokens=2048, llm_overrides=llm_overrides,
    )
    return _parse_json(raw)


async def suggest_transform(
    agent: Agent,
    sources: list[Source],
    description: str,
    db: AsyncSession,
    llm_overrides: dict | None = None,
    language: str | None = None,
) -> dict:
    """AI generates a single SQL transform step."""
    source_info = []
    for src in sources:
        meta = src.metadata_ or {}
        columns = meta.get("columns", [])
        source_info.append(f"Source: {src.name} ({src.type}), columns: {', '.join(columns[:20])}")

    schema_text = "\n".join(source_info)
    lang = LANGUAGE_NAMES.get(language or "", "")
    lang_inst = f"Write ALL text in {lang}. " if lang else ""

    system = (
        "You are a data engineer. Generate a SQL transformation step.\n\n"
        f"{lang_inst}"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "name": "step_name",\n'
        '  "sql": "SELECT ... FROM ...",\n'
        '  "description": "What this transform does",\n'
        '  "output_columns": ["col1", "col2"]\n'
        "}\n"
        "For CSV sources, the table name is 'data'. Quote column names if needed."
    )

    user_msg = f"Available sources:\n{schema_text}\n\nTransform goal: {description}"

    raw, usage, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        max_tokens=1024, llm_overrides=llm_overrides,
    )
    return _parse_json(raw)


def build_lineage(pipeline_config: dict) -> dict:
    """Build a lineage graph from pipeline steps."""
    steps = pipeline_config.get("steps", [])
    nodes = []
    edges = []

    for step in steps:
        nodes.append({
            "id": step.get("id", ""),
            "name": step.get("name", ""),
            "type": step.get("type", "transform"),
        })
        for dep in step.get("depends_on", []):
            edges.append({"from": dep, "to": step.get("id", "")})

        # Add source node if extract step
        if step.get("type") == "extract" and step.get("source"):
            src_id = f"src_{step['source']}"
            if not any(n["id"] == src_id for n in nodes):
                nodes.append({"id": src_id, "name": step["source"], "type": "source"})
            edges.append({"from": src_id, "to": step.get("id", "")})

    return {"nodes": nodes, "edges": edges}


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
