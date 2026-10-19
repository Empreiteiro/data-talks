---
name: qa-pipeline
description: How a natural-language question flows through Data Talks — routing, context assembly, the generate→execute→elaborate pattern, follow-ups, on-demand chart specs, SQL mode and the generated-query panel. Use when changing `routers/ask.py`, any `scripts/ask_*.py`, `llm/elaborate.py`, `llm/followups.py`, `llm/charting.py`, or the chat UI in `src/pages/Workspace.tsx`.
---

# Q&A pipeline

## How it works

### Entry points
- `POST /api/ask-question` → `ask_question` (`backend/app/routers/ask.py`): loads the Agent with
  `tenant_filter`, loads sources from `agent.source_ids` (else `Source.agent_id`), resolves LLM overrides
  (`resolve_agent_llm_overrides`, see `llm-client`), loads `QASession.conversation_history` when `sessionId` is
  given, reads `agent.sql_mode`, then calls `dispatch_question`.
- MCP, public API (`/v1/ask`), bots and alerts reach the same scripts through `dispatch_question` or their own
  copies — check `alerts-and-channels` before assuming they share this path.

### `dispatch_question`
1. `unlock_source_metadata(s)` for every source (decrypts secrets in place — see `tenancy-and-secrets`).
2. `_build_active_multi_sql_sources`: if 2+ `sql_database` sources exist (active or not), the multi-SQL script
   wins over everything else.
3. Primary source = first active source (query has no `ORDER BY`, so "first" is DB order).
4. Workspace context block, built once, best-effort (`except Exception: workspace_context_block = ""`):
   1. per-source `metadata_["onboarding_instructions"]` as ``Instructions for source `{name}`:``
   2. `build_workspace_context_block(clarifs, kpis)` → `Known clarifications…` Q/A pairs, then
      `KPIs defined in this workspace:` (name + definition only)
   3. `_build_agent_description(agent)`: CDP/ETL persona from `_WORKSPACE_SYSTEM_CONTEXTS` + `agent.description`
   `_description_for(agent)` glues these together and is passed as `agent_description` to every script.
5. Branch on `source.type` (~36 types); unknown type → `400 Unsupported source type`.
6. Persist the turn (below), finish the lineage run, `db.commit()`.

### Inside a script (`ask_csv.py`, `ask_sql.py`, … all copy the same shape)
1. Build `schema_text` (+ profile and up to 5 sample rows for file-like sources).
2. Messages: `system` (role, rules, JSON contract `{answer, followUpQuestions, sqlQuery}`, then
   `\nContext:`/`\nAgent context:` + agent_description) → last 5 turns as `user: question` /
   `assistant: answer` (no SQL, no rows) → final `user` with schema, profile, samples and the question.
3. LLM call #1 (`chat_completion`, `max_tokens=2048`, logged with `trace["stage"]="pergunta_main"`).
4. Parse leniently (`_parse_llm_json`: strip fences → `json.loads` → slice `{…}` → raw text).
5. Execute the SQL (SELECT check — see `sql-sources`) and, with rows, call
   `elaborate_answer_with_results(question=…, query_results=rows, …)` (LLM #2, ≤50 rows shown,
   `"... and N more rows"`), which itself calls `refine_followup_questions` (LLM #3).
6. The script calls `refine_followup_questions` again (LLM #4 — redundant, kept for now).
7. Return `{answer, imageUrl: None, followUpQuestions, chartInput}` where
   `chartInput = build_chart_input(rows, schema_text)` (first 30 rows, JSON-safe, + `rowCount`).

### Filters
Workspace filters never reach the backend as structure. `buildConstraintsLine()` in
`src/pages/Workspace.tsx` prepends `Constraints: col BETWEEN a AND b; col = "v".\n\n` to the outgoing question
(hidden from the chat bubble). One prose line works for every backend (CSV, SQL, BigQuery, Sheets) without
per-script translation. Consequence: the stored `question`, and therefore history, contains the prefix.

### Charts (on demand, client-rendered)
- The UI shows "Generate chart" per assistant turn → `POST /api/ask-question/{session_id}/chart`
  (`generate_chart_for_turn`). A cached `turn.chartSpec` is returned as is.
- `build_chart_plan` (`llm/charting.py`, `max_tokens=900`) asks for JSON
  `{suitable, chartType: bar|horizontal_bar|line|pie, title, subtitle, xLabel, yLabel, categories, series[{name, values}], insight}`;
  `_normalize_plan` caps 12 categories / 4 series, drops series whose length ≠ categories, coerces unknown types
  to `bar`, multi-series pie → `bar`. On failure it returns `_heuristic_plan` (first label column × first numeric
  column; one row with many numerics → bar of metrics; `horizontal_bar` when a label is > 18 chars).
- The spec is saved on the turn and drawn by Recharts in `src/components/ChartRenderer.tsx`.
- `render_chart` / `build_matplotlib_script` are dead code; the legacy PNG endpoint
  `GET /{session_id}/chart/{turn_id}/image` remains. Studio/template reports still render matplotlib PNGs.

### SQL mode and the generated-query panel
- `agent.sql_mode` (public API can override per request): `if sql_mode and sql_query: answer = sql_query` — no
  execution, no elaboration (sql, bigquery, dbt via sql, multi). `ask_csv` has no SQL mode.
- `_extract_generated_query(result)` normalizes `sqlQuery` | `sql` → `"sql"`, else `pandasCode` → `"python"`.
  Stored as `generatedSql`/`generatedSqlLang` and shown by `GeneratedSqlPanel.tsx` (collapsed, copyable).
  Tested in `backend/tests/test_generated_query.py`.

### Persisted turn (`QASession.conversation_history[]`)
`{id, question, answer, imageUrl, followUpQuestions, chartInput, chartSpec, chartScript, generatedSql,
generatedSqlLang, timestamp}`. New list is built and reassigned (JSON columns don't track in-place mutation).

## How to change it
- New context for the model: add it to the workspace context block in `dispatch_question` (keep it best-effort
  and plain text), not to individual scripts. Keep UI chips and the LLM context on the same inclusion rule.
- New script: follow `ask_sql.py`, call helpers with keyword arguments, and return the executed query:
  `{answer, imageUrl, followUpQuestions, chartInput, sqlQuery}` (or `pandasCode`). Otherwise the panel stays empty.
- Grounding: only present an answer as fact after the query ran. If no query ran or it failed, say so instead of
  returning the first-pass answer.
- New chart types must be added to the prompt, `_normalize_plan`, the `ChartSpec` type and `ChartRenderer.tsx`.

## Known pitfalls in the current code
- Only `ask_sql_multi` returns `sqlQuery`; every other script (including MongoDB's `pandasCode`) drops it, so
  `GeneratedSqlPanel` is empty for single-source SQL, files and SaaS sources.
- The first-pass `answer` is written before any data is seen. When SQL is missing, rejected or fails, that guess is
  what the user gets, plus `*Erro ao executar a consulta SQL: {e}*` (raw driver text, Portuguese).
- `if rows:` (sqlite, snowflake, s3, rest_api) vs `if rows is not None` (csv, sql, bigquery): with 0 rows the
  former keeps the ungrounded first-pass answer. Use `is not None`.
- `_extract_followups` calls `str.replace` with a regex pattern, so numbering is never stripped.
- `build_chart_plan` returns the heuristic even when the model says `suitable: false`; chart calls are not logged.
- Hardcoded Portuguese leaks into answers and specs ("Erro ao executar…", "Grafico gerado pelo agente",
  series name "Valor", multi-SQL prompt labels). Q&A has no explicit language instruction; it relies on mirroring.
- History replays answers only, never the previous SQL, so "now by month" must re-derive the query.
- `ask_csv` prompt says "Total rows" after the 100k cap and "table named 'data'" even when tables are renamed.

## Checks before you finish
- `cd backend && pytest -q tests/test_generated_query.py` (and the full suite).
- `npm run typecheck && npm run lint` when touching `Workspace.tsx`, `ChartRenderer.tsx` or `GeneratedSqlPanel.tsx`.
- Ask one question per touched source type in `make dev`; open the generated-query panel and generate a chart.

General version: `data-analytics:grounded-answers` (also `text-to-sql`, `chart-spec`) in https://github.com/Empreiteiro/skills
