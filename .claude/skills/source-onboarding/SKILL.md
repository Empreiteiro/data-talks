---
name: source-onboarding
description: The LLM-driven source onboarding flow in Data Talks — clarifying questions, warm-up questions, KPI candidates, filter suggestions, source-scoped instructions, SQL relationships and multi-source SourceGroups — and how each saved asset reaches Q&A. Use when changing `llm/onboarding.py`, `routers/onboarding_router.py`, `src/components/SourceOnboarding.tsx`, the onboarding models (SourceClarification, SourceWarmup, SourceFilter, OrganizationKpi, SourceGroup) or how workspace knowledge is injected into prompts.
---

# Source onboarding

Purpose: capture the domain knowledge that makes later Q&A reliable (what `mrr_usd` means, which timezone,
which KPIs matter) once, right after a source is connected, and replay it on every question.

## How it works

### Profile (input)
- `_build_source_profile(source)` copies keys already in `Source.metadata_`
  (`tables, table_infos, columns, preview_rows, sample_profile, row_count, schema, datasetId, projectId`).
  It does **not** re-introspect: re-reading a 500-table warehouse inside a modal is the wrong trade-off, so profile
  quality depends on what source creation stored (see `file-sources`, `add-data-source`).
- Multi-source: `build_multi_source_profile` → `{"kind": "multi_source", "source_count": N, "sources": [...]}`.

### One LLM call: `generate_onboarding_suggestions(profile, language, llm_overrides)`
- Profile `json.dumps(..., default=str)[:60_000]`, `max_tokens=2048`, language via `_lang_instruction`
  (`pt` → pt-BR, `es` → Spanish, else English).
- Four lists in one JSON object:
  - `clarifications` 3–6: questions whose answers improve later SQL/Python (ambiguous names, identifier meaning,
    timezones, what "active"/"paid" mean).
  - `warmup_questions` 4–8 starter questions.
  - `kpis` 2–6: `{name, definition, dependencies: {tables, columns}}` — "Only propose KPIs the data actually
    supports — do not invent columns."
  - `filters` 0–5: `kind="date"` (range on a date column, `config={}`) or `kind="category"` (low-cardinality column,
    `config={"values": [...]}` from the profile's `top_values`). Cardinality is judged by the LLM; no threshold in code.
- Multi-source prompt: probe join keys and conflicting meanings ("Is `users.id` the same identifier as
  `orders.user_id`?", "same timezone?") and propose KPIs/warm-ups that combine sources.
- Parsing: `_coerce_json` strips fences, regex `\{.*\}`, and **raises** on garbage → router returns **502**. We never
  fall back to fake suggestions; a flow that silently saves nothing is worse than an error. `_safe_list` keeps
  dict items only.

### Save: `POST /api/sources/{id}/onboarding/save` (`require_role("member")`)
| Asset | Storage | Semantics |
|---|---|---|
| Clarifications | `SourceClarification(source_id, question, answer)` | replace-all per source; empty Q or A skipped |
| Warm-ups | `SourceWarmup(source_ids=[source.id], text)` | replace-all for exactly `[source.id]` |
| Agent instructions | `Agent.description` | `None` = untouched, `""` = clear |
| KPIs | `OrganizationKpi` | upsert by id; current source always added to `source_ids`; `dependencies` stored as is |
| Filters | `SourceFilter(name, column, kind, config, source_ids)` | `kind ∈ {date, category}`; category config sanitized to `{"values": [str]}`, date to `{}`; replace-all for `[source.id]` |
| Source instructions + done stamp | `metadata_["onboarding_instructions"]`, `metadata_["onboarding_completed_at"]` | copy the dict, mutate, reassign (`meta = dict(source.metadata_ or {})`) — JSON columns don't track in-place changes |

- Edit vs fresh mode is gated on `onboarding_completed_at`, not on asset counts (commit 07b502a: agent-wide warm-ups
  made brand-new sources look onboarded and skipped the LLM call).
- Warm-ups moved from `Agent.suggested_questions` to `SourceWarmup` (1b1431e) so source A's warm-ups don't show in a
  workspace that only has source B.
- SQL relationships step (d8170fb): accepted suggestions are `PUT /sql/agents/{id}/relationships` **before**
  onboarding is marked complete, so a save failure stops the flow on that step (see `sql-sources`).

### SourceGroup (several sources added or selected together)
- `_canonical_source_ids` sorts + dedupes; `_get_or_create_group` upserts on (org, agent_id, canonical set),
  comparing sets **in Python** because JSON-column equality is not portable across SQLite/Postgres.
- Group save pins warm-ups and filters to the canonical set, gives KPIs every member id, writes
  `SourceGroup.instructions`, stamps `group.onboarding_completed_at`.

### How each asset reaches Q&A
| Asset | Path |
|---|---|
| Clarifications, KPIs (name + definition), source instructions, agent description | Workspace context block in `dispatch_question` (see `qa-pipeline`) |
| Warm-ups | UI chips: `GET /agents/{id}/warmup-questions` (agent list + overlapping `SourceWarmup`, deduped case-insensitively) |
| KPIs | Also UI chips: `GET /agents/{id}/kpis`; a chip inserts only the KPI **name** into the question |
| Filters | `GET /agents/{id}/filters` → popover → `Constraints:` prefix built in `Workspace.tsx` |

Shared inclusion rule (keep LLM context and UI chips identical): an asset applies when its `source_ids` is empty
(cross-source) **or overlaps** the active sources.

## How to change it
- New asset type: add it to the prompt + output schema, a Pydantic response model (`schemas.py`), a table with
  `organization_id` + `source_ids` (and an Alembic migration, see `db-migrations`), the save endpoint with explicit
  replace/upsert semantics, and one consumer path from the table above using the shared inclusion rule.
- Keep the onboarding call language-explicit and the parse-or-502 policy.
- Validate LLM-proposed columns/tables against the profile before saving (relationships already do this).

## Known pitfalls in the current code
- `SourceGroup.instructions` is written but **never read** by `dispatch_question`: group-level instructions have no
  effect on answers.
- Group clarifications are all pinned to `canonical[0]`, so they only apply when that one source is active.
- KPI `dependencies` are never validated against the schema and never injected into prompts.
- Response models require `name`/`definition` (KPIs) and `name`/`column`/`kind` (filters): one incomplete LLM item
  becomes a 500 instead of being dropped. Filter items before building the response.
- Onboarding, chart and relationship LLM calls are not logged through `record_log` (no cost visibility).
- Category values come from only the top-3 `top_values` of a 1000-row sample.
- Stale docs: `onboarding.py` header says three lists (there are four); `onboarding_save` docstring and
  `models.py`/`SourceOnboarding.tsx` comments still describe warm-ups appended to `Agent.suggested_questions`.

## Checks before you finish
- `cd backend && pytest -q` (no onboarding tests exist yet — add one with `chat_completion` mocked, like
  `tests/test_automl.py`).
- In `make dev`: upload a CSV, complete onboarding, re-open it (edit mode), then ask a question and check the logged
  trace contains the clarifications/KPIs block.

General version: `data-analytics:dataset-onboarding` in https://github.com/Empreiteiro/skills
