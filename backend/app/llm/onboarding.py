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
    "stats) and produce three things: \n"
    "  1. clarifications: 3 to 6 short questions whose answers will help "
    "you write better SQL/Python against this data later (ambiguous "
    "column names, business meaning of identifiers, time-zone of date "
    "columns, what 'active' or 'paid' mean here, etc).\n"
    "  2. warmup_questions: 4 to 8 starter questions a user might ask "
    "this dataset. Phrase them as full natural-language questions.\n"
    "  3. kpis: 2 to 6 candidate KPIs (name + one-line definition + "
    "the tables/columns the KPI reads). Only propose KPIs the data "
    "actually supports — do not invent columns.\n"
    "\n"
    "Return ONLY a JSON object with exactly this shape — no prose, no "
    "code fences, no preamble:\n"
    "{\n"
    '  "clarifications": [{"question": "..."}],\n'
    '  "warmup_questions": [{"text": "..."}],\n'
    '  "kpis": [{"name": "...", "definition": "...", '
    '"dependencies": {"tables": ["..."], "columns": ["..."]}}]\n'
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
