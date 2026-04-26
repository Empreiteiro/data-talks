"""
Data Engineering Tools API — AI-powered schema docs, quality tests, ERD,
query analysis, transformation mapping, lineage, incremental strategy,
and ETL documentation.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import TenantScope, require_membership, require_user
from app.services.tenant_scope import tenant_filter
from app.database import get_db
from app.models import User, Agent, Source, LlmConfig
from app.llm.client import chat_completion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data-engineering", tags=["data-engineering"])

LANGUAGE_NAMES = {"en": "English", "pt": "Portuguese", "es": "Spanish"}


class ToolRequest(BaseModel):
    agentId: str
    language: Optional[str] = None
    context: Optional[str] = None  # extra user context / SQL to analyze


async def _get_agent_sources_llm(agent_id: str, user: User, db: AsyncSession):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, tenant_filter(Agent, scope)))
    agent = r.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Workspace not found")

    r_src = await db.execute(
        select(Source).where(tenant_filter(Source, scope), Source.agent_id == agent.id)
    )
    sources = list(r_src.scalars().all())

    from app.routers.ask import resolve_agent_llm_overrides
    llm_overrides = await resolve_agent_llm_overrides(db, agent, scope.user.id)

    return agent, sources, llm_overrides


def _build_schema_context(sources: list[Source]) -> str:
    parts = []
    for src in sources:
        meta = src.metadata_ or {}
        columns = meta.get("columns", [])
        profile = meta.get("sample_profile", {})
        col_details = []
        for col in columns[:30]:
            info = profile.get("columns", {}).get(col, {})
            dtype = info.get("type", "?")
            missing = info.get("missing", 0)
            col_details.append(f"  - {col} ({dtype}, missing={missing})")
        row_count = meta.get("row_count", "?")
        parts.append(f"Source: {src.name} ({src.type}, {row_count} rows)\n" + "\n".join(col_details))
    return "\n\n".join(parts)


def _lang_instruction(language: str | None) -> str:
    name = LANGUAGE_NAMES.get(language or "", "")
    return f"Write ALL output in {name}. " if name else ""


async def _call_llm(system: str, user_msg: str, llm_overrides: dict | None, max_tokens: int = 2048) -> str:
    raw, _, _ = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        max_tokens=max_tokens, llm_overrides=llm_overrides,
    )
    return raw.strip()


# ---------------------------------------------------------------------------
# #111 — Schema Documentation & Data Dictionary
# ---------------------------------------------------------------------------

@router.post("/schema-docs")
async def generate_schema_docs(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Generate a data dictionary with LLM-inferred descriptions for all columns."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    system = (
        f"You are a data documentation specialist. {_lang_instruction(body.language)}"
        "Generate a comprehensive data dictionary in Markdown format.\n"
        "For each table: description, then a table with columns: Name, Type, Description, Nullable, Example.\n"
        "Infer column descriptions from names, types, and sample data context.\n"
        "Be specific and professional."
    )
    result = await _call_llm(system, schema, llm)
    return {"content": result, "format": "markdown"}


# ---------------------------------------------------------------------------
# #110 — Data Quality Test Generator
# ---------------------------------------------------------------------------

@router.post("/quality-tests")
async def generate_quality_tests(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Generate data quality tests in multiple formats (dbt, SQL, Great Expectations)."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    fmt = body.context or "sql"  # sql | dbt | great_expectations | soda
    system = (
        f"You are a data quality engineer. {_lang_instruction(body.language)}"
        f"Generate data quality tests in {fmt} format.\n"
        "Analyze the schema and generate tests for: not_null on required columns, "
        "unique on ID columns, accepted_values for enums, relationships between tables, "
        "numeric ranges, date ranges, and custom business rules.\n"
        "Return the tests as ready-to-use code."
    )
    result = await _call_llm(system, schema, llm)
    return {"content": result, "format": fmt}


# ---------------------------------------------------------------------------
# #114 — ERD & Relationship Discovery
# ---------------------------------------------------------------------------

@router.post("/erd")
async def generate_erd(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Auto-detect relationships and generate ERD in Mermaid format."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    system = (
        f"You are a data modeling expert. {_lang_instruction(body.language)}"
        "Analyze the schemas and detect foreign key relationships using:\n"
        "1. Naming conventions (customer_id → customers.id)\n"
        "2. Column type/value overlap\n"
        "3. Business logic inference\n\n"
        "Return a Mermaid erDiagram with all tables and relationships.\n"
        "Format: ```mermaid\nerDiagram\n  TABLE1 ||--o{ TABLE2 : has\n```\n"
        "Also provide a brief explanation of each relationship found."
    )
    result = await _call_llm(system, schema, llm)
    return {"content": result, "format": "mermaid"}


# ---------------------------------------------------------------------------
# #113 — Query Performance Analyzer
# ---------------------------------------------------------------------------

@router.post("/query-analysis")
async def analyze_query(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Analyze SQL for performance issues and suggest optimizations."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    sql_to_analyze = body.context or ""
    if not sql_to_analyze.strip():
        raise HTTPException(400, "Provide SQL to analyze in the 'context' field")

    system = (
        f"You are a SQL performance expert. {_lang_instruction(body.language)}"
        "Analyze the SQL query for:\n"
        "1. Anti-patterns (SELECT *, implicit cartesian joins, etc.)\n"
        "2. Missing index opportunities\n"
        "3. Partitioning recommendations\n"
        "4. Rewrite suggestions for better performance\n"
        "5. Estimated complexity analysis\n\n"
        "Provide the optimized SQL and explain each change.\n"
        f"Available schema:\n{schema}"
    )
    result = await _call_llm(system, f"SQL to analyze:\n{sql_to_analyze}", llm)
    return {"content": result, "format": "markdown"}


# ---------------------------------------------------------------------------
# #112 — Transformation Mapping Assistant
# ---------------------------------------------------------------------------

@router.post("/transformation-mapping")
async def suggest_transformation_mapping(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Suggest column-by-column mapping between source and target schemas."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    target_schema = body.context or ""
    system = (
        f"You are a data integration specialist. {_lang_instruction(body.language)}"
        "Given source schemas and optionally a target schema, suggest column-by-column mappings.\n"
        "For each mapping provide:\n"
        "- Source column → Target column\n"
        "- Transformation expression (CAST, TRIM, COALESCE, lookup, etc.)\n"
        "- Data type conversion\n"
        "- Notes on potential data loss or quality issues\n\n"
        "Return as a Markdown table and the full SQL transformation query."
    )
    user_msg = f"Source schemas:\n{schema}"
    if target_schema:
        user_msg += f"\n\nTarget schema:\n{target_schema}"
    else:
        user_msg += "\n\nNo target schema provided — suggest a clean, normalized target schema."

    result = await _call_llm(system, user_msg, llm)
    return {"content": result, "format": "markdown"}


# ---------------------------------------------------------------------------
# #116 — Incremental Strategy Advisor
# ---------------------------------------------------------------------------

@router.post("/incremental-strategy")
async def suggest_incremental_strategy(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Recommend incremental loading strategy based on data profiling."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    system = (
        f"You are a data engineering strategist. {_lang_instruction(body.language)}"
        "Analyze the data sources and recommend the optimal incremental loading strategy for each table:\n"
        "- Append-only (event/log data)\n"
        "- Merge/Upsert (with natural key)\n"
        "- SCD Type 1 (overwrite)\n"
        "- SCD Type 2 (history tracking)\n"
        "- Snapshot\n"
        "- Full Refresh\n\n"
        "For each recommendation, explain WHY and provide:\n"
        "1. The strategy name\n"
        "2. The key columns (unique key, updated_at, etc.)\n"
        "3. The SQL or dbt configuration\n"
        "4. Trade-offs and caveats"
    )
    result = await _call_llm(system, schema, llm)
    return {"content": result, "format": "markdown"}


# ---------------------------------------------------------------------------
# #115 — ETL Documentation Reverse-Engineer
# ---------------------------------------------------------------------------

@router.post("/etl-docs")
async def reverse_engineer_etl_docs(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Generate natural language documentation from SQL code."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    sql_code = body.context or ""
    if not sql_code.strip():
        raise HTTPException(400, "Provide SQL/ETL code to document in the 'context' field")

    system = (
        f"You are a technical writer for data engineering. {_lang_instruction(body.language)}"
        "Read the SQL code and generate comprehensive documentation:\n"
        "1. Overall purpose and business context\n"
        "2. Step-by-step CTE/subquery explanation\n"
        "3. Input tables and columns used\n"
        "4. Output schema\n"
        "5. Implicit business rules and logic\n"
        "6. Data flow diagram (as Mermaid flowchart)\n\n"
        f"Available schema context:\n{schema}"
    )
    result = await _call_llm(system, f"SQL/ETL code to document:\n{sql_code}", llm)
    return {"content": result, "format": "markdown"}


# ---------------------------------------------------------------------------
# #117 — Data Catalog & Lineage
# ---------------------------------------------------------------------------

@router.post("/catalog")
async def generate_catalog(body: ToolRequest, scope: TenantScope = Depends(require_membership), db: AsyncSession = Depends(get_db)):
    """Generate a data catalog with lineage graph."""
    agent, sources, llm = await _get_agent_sources_llm(body.agentId, user, db)
    schema = _build_schema_context(sources)

    system = (
        f"You are a data governance specialist. {_lang_instruction(body.language)}"
        "Generate a data catalog in Markdown:\n"
        "1. Asset inventory: list all tables/sources with description, row count, column count, type\n"
        "2. Column-level metadata: key columns, sensitive data flags, PII detection\n"
        "3. Data lineage: which sources feed into which tables (as Mermaid flowchart)\n"
        "4. Data classification: tag each table (raw, staging, clean, aggregate, report)\n"
        "5. Recommendations for organization and governance"
    )
    result = await _call_llm(system, schema, llm)
    return {"content": result, "format": "markdown"}
