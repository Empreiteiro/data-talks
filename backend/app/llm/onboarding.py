"""LLM helper for the source-onboarding flow.

Single entry point: `generate_onboarding_suggestions(profile, language,
llm_overrides)`. Builds a prompt around the source profile (tables,
columns, sample rows) and asks the configured LLM to return a JSON object
with three lists: `clarifications`, `warmup_questions`, `kpis`.

We deliberately use a JSON-only contract (`response_format` would be
provider-specific; instead we instruct the model and parse defensively)
because the same code path has to work across OpenAI, Anthropic, Ollama,
LiteLLM, Google, and Claude Code. All of them are good at "return only
JSON" when the system prompt says so explicitly and the user message
ends with the schema.

Failure mode: if the model returns garbage, we don't fall back to fake
data — we raise. The router translates that into HTTP 502 so the user
sees a real error instead of a flow that silently saved nothing.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.llm.client import chat_completion


_SYSTEM_PROMPT = (
    "You are a senior data analyst helping the user onboard a new data "
    "source into an analytics platform. Your job is to read a structured "
    "profile of the source (tables, columns, types, sample rows, sample "
    "stats) and produce four things: \n"
    "  1. clarifications: 3 to 6 short questions whose answers will help "
    "you write better SQL/Python against this data later (ambiguous "
    "column names, business meaning of identifiers, time-zone of date "
    "columns, what 'active' or 'paid' mean here, etc).\n"
    "  2. warmup_questions: 4 to 8 starter questions a user might ask "
    "this dataset. Phrase them as full natural-language questions.\n"
    "  3. kpis: 2 to 6 candidate KPIs (name + one-line definition + "
    "the tables/columns the KPI reads). Only propose KPIs the data "
    "actually supports — do not invent columns.\n"
    "  4. filters: 0 to 5 useful filter candidates the user is likely "
    "to slice the data by. Each is one of:\n"
    "       - kind=\"date\": a date column you'd put a range filter on "
    "(e.g. created_at, order_date). config={} (defaults inferred at "
    "query time).\n"
    "       - kind=\"category\": a low-cardinality column with a small "
    "set of values (region, status, plan_type). config={\"values\": "
    "[\"...\"]} listing the realistic candidate values from the "
    "sample profile's `top_values`. Only include filters whose "
    "column actually appears in the source schema.\n"
    "\n"
    "If the profile has `\"kind\": \"multi_source\"`, the user is "
    "onboarding several sources together. In that case you should "
    "explicitly probe the JOIN/KEY relationships between them in the "
    "clarifications (e.g. 'Is `users.id` the same identifier as "
    "`orders.user_id`?', 'Do both sources use the same timezone?'), "
    "and propose KPIs/warm-ups that COMBINE the sources where it "
    "makes sense — that's where the most useful onboarding signal "
    "lives.\n"
    "\n"
    "Return ONLY a JSON object with exactly this shape — no prose, no "
    "code fences, no preamble:\n"
    "{\n"
    '  "clarifications": [{"question": "..."}],\n'
    '  "warmup_questions": [{"text": "..."}],\n'
    '  "kpis": [{"name": "...", "definition": "...", '
    '"dependencies": {"tables": ["..."], "columns": ["..."]}}],\n'
    '  "filters": [{"name": "...", "column": "...", '
    '"kind": "date" | "category", "config": {"values": ["..."]}}]\n'
    "}"
)


def _lang_instruction(language: str | None) -> str:
    """Mirror the same lightweight i18n hint other LLM helpers in this
    repo use (see summary_csv.py)."""
    code = (language or "").strip().lower()
    if code.startswith("pt"):
        return " Respond with the JSON values in Portuguese (pt-BR)."
    if code.startswith("es"):
        return " Respond with the JSON values in Spanish."
    return " Respond with the JSON values in English."


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _coerce_json(raw: str) -> dict[str, Any]:
    """LLMs sometimes wrap JSON in code fences or chatty preambles even
    when told not to. Strip the fence and grab the outermost `{...}`
    block before parsing — much more forgiving than `json.loads(raw)`
    while still raising clearly when the response has no JSON at all.
    """
    text = (raw or "").strip()
    # Strip ```json ... ``` fences if present.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = _JSON_BLOCK_RE.search(text)
        if not match:
            raise
        return json.loads(match.group(0))


def _safe_list(d: dict[str, Any], key: str) -> list[dict[str, Any]]:
    val = d.get(key) or []
    if not isinstance(val, list):
        return []
    return [v for v in val if isinstance(v, dict)]


async def generate_onboarding_suggestions(
    profile: dict[str, Any],
    language: str | None = None,
    llm_overrides: dict[str, Any] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Return `{"clarifications": [...], "warmup_questions": [...], "kpis": [...]}`.

    `profile` is whatever the source-introspection step produced — a
    `dict` with keys like `source_type`, `source_name`, `tables`,
    `sample_profile`, `sample_rows`. Pass it through json.dumps as-is
    rather than reformatting; the model handles arbitrary nested JSON
    fine and we don't want to silently lose fields.

    Synchronous from the user's POV (Task 3 decision: "synchronous so
    the user is forced to either answer or skip"). The router awaits
    this directly.
    """
    user_prompt = (
        "Source profile (JSON):\n"
        + json.dumps(profile, default=str)[:60_000]
        + "\n\n"
        + "Produce the JSON described in the system prompt."
        + _lang_instruction(language)
    )
    content, _usage, _trace = await chat_completion(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=2048,
        llm_overrides=llm_overrides,
    )
    parsed = _coerce_json(content)
    return {
        "clarifications": _safe_list(parsed, "clarifications"),
        "warmup_questions": _safe_list(parsed, "warmup_questions"),
        "kpis": _safe_list(parsed, "kpis"),
        "filters": _safe_list(parsed, "filters"),
    }


def build_multi_source_profile(
    profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    """Combine N single-source profiles into a single profile object the
    `generate_onboarding_suggestions` prompt can reason over.

    Shape:
      {
        "kind": "multi_source",
        "source_count": N,
        "sources": [
          {"name": "...", "type": "...", "tables": [...], "sample_profile": {...}, "sample_rows": [...]},
          ...
        ]
      }

    The kind discriminator tells the LLM "this profile spans more than
    one source — propose clarifications/KPIs/filters that USE this
    combination, not just each source in isolation". Cross-source
    join keys, conflicting column meanings, mismatched timezones —
    these are exactly the points the user said are most worth
    capturing during a group onboarding pass.
    """
    return {
        "kind": "multi_source",
        "source_count": len(profiles),
        "sources": profiles,
    }


def build_workspace_context_block(
    clarifications: list[dict[str, str]],
    kpis: list[dict[str, Any]],
) -> str:
    """Render saved clarifications + KPIs as a single text block to
    prepend to the system prompt of every Q&A call.

    Returns an empty string when there is nothing to inject — the caller
    can blindly concatenate. We prefer this over multiple system blocks
    because every provider in the dispatch handles a single system
    string identically; structured blocks are a Claude Code OAuth quirk
    we don't want to leak to other providers.
    """
    parts: list[str] = []
    if clarifications:
        parts.append("Known clarifications about the data source:")
        for c in clarifications:
            q = (c.get("question") or "").strip()
            a = (c.get("answer") or "").strip()
            if q and a:
                parts.append(f"- Q: {q}\n  A: {a}")
    if kpis:
        if parts:
            parts.append("")
        parts.append("KPIs defined in this workspace:")
        for k in kpis:
            n = (k.get("name") or "").strip()
            d = (k.get("definition") or "").strip()
            if n and d:
                parts.append(f"- {n}: {d}")
    return "\n".join(parts).strip()
