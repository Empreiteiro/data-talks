---
name: studio-reports
description: How Studio outputs work in Data Talks — table summaries, the exploratory HTML report, audio overviews, and the three kinds of "report templates" (connector hint lists, JSON templates, LLM-generated templates) — and how to change them safely. Use when touching summary_*.py, report_*.py, report_generator.py, audio_overview_router.py, template_registry/template_executor, template_router.py, or backend/app/templates/*.json.
---

# Studio: summaries, reports, audio, templates

All Studio LLM calls pass `channel="studio"` and log via `record_log` with a `trace["stage"]` tag.
The common rule behind every output here: **compute facts deterministically, let the LLM narrate or plan, then
validate the plan against real columns and render deterministically.**

## Table summaries (`routers/summary_router.py` → `scripts/summary_<type>.py`)

- Supported types: `bigquery`, `csv`/`xlsx`, `sql_database`, `google_sheets`, `firebase` (the endpoint docstring
  "BigQuery only for now" is stale). Result is stored as `TableSummary(report markdown, queries_run)`.
- `summary_csv.py` — one LLM call, **never the full table**. Prefers the stored `columns`, `sample_profile` and
  `sample_row_count` from `Source.metadata_`; otherwise reads `nrows=2000` and profiles with
  `ask_csv._build_sample_profile`. Fixed Markdown template: Overview / Data Description table / Key Insights /
  Data Quality / Conclusion, with "Base your report ONLY on: the column list, the sample profile, total row count,
  and the tiny sample provided."
- `summary_sql.py` (also BigQuery, Firebase) — two calls:
  1. LLM proposes 3–5 analytical SELECTs as `{"queries": [...]}` ("Do not include LIMIT…the system will add it").
  2. `_ensure_limit` appends `LIMIT 15` unless the text already has `LIMIT`/`FETCH`; results are capped at 15 rows.
  3. LLM writes the report from schema + probe results (Overview, Data Description, Key Metrics, Insights &
     Observations, Data Quality). Firebase runs pandas expressions instead of SQL on ≤500 docs per collection.
- `summary_google_sheets.py` uses column names only.
- Language: `LANGUAGE_NAMES` en/pt/es → "Write ALL text output in {lang}."; otherwise "same language as the data".

## Exploratory report (`scripts/report_generator.py`, `routers/report_router.py`)

`generate_report(df, source_name, llm_overrides, channel, language)` → `{html_content, chart_count}`:

| Step | Kind | What |
|---|---|---|
| `_profile_dataframe` | deterministic | numeric/categorical/datetime split (object column is datetime if >80% of 20 samples parse), min/max/mean/median/std/q25/q75, top-10 values, missing %, nunique, correlations, 5 sample rows |
| `_generate_observations` | LLM | HTML `<h3>/<p>/<ul>`, ≤600 words, `stage=report_observations` |
| `_plan_charts` | LLM | JSON array `{chartType, title, columns, description}`; types histogram/bar/pie/line/scatter/heatmap/box/missing; columns validated against the profile; empty → `_fallback_chart_plan` |
| `_render_chart` | deterministic | matplotlib → base64 PNG with `PLATFORM_THEME`/`PALETTE` from `llm/charting.py`; a failing chart is dropped |
| `_generate_chart_explanations` | LLM | one batched call, JSON array of strings |
| `_assemble_html` | deterministic | stat cards, observations, column profile table, charts |

Wrappers load data: `report_csv.py` (`nrows=MAX_ROWS_FOR_PROFILE` = 5000), `report_sql.py` / `report_bigquery.py`
(`SELECT * FROM <first table> LIMIT 5000`), `report_google_sheets.py`. SaaS connectors get "not supported".

## Audio overviews (`routers/audio_overview_router.py`)

Provider must be `openai` or `litellm` with an audio model (else 400) → summary report → `_build_audio_script`
(plain text, 60–110 words) → `_normalize_audio_script` (strip markdown, hard cap `MAX_SCRIPT_WORDS = 110`) →
`llm.client.synthesize_speech` (voice `alloy`, mp3) → stored at `audio_overviews/{user_id}/{id}.mp3` +
`AudioOverview` row. Note: the summary step here does not pass `language`.

## "Report templates" means three different things

1. **Per-connector `REPORT_TEMPLATES` constants** in `scripts/ask_<vendor>.py` — lists of
   `{name, description, questions[]}`. Stripe uses them as prompt hints; HubSpot/Salesforce/Pipedrive/Shopify
   routers copy them into `metadata_["report_templates"]`, which no frontend code reads. They are suggested
   questions, not fixed-schema reports.
2. **JSON templates** in `backend/app/templates/*.json`, loaded by `services/template_registry.py` (files starting
   with `_` are skipped; a file holds one object or a list; indexed by `id`; `reload_templates()` clears cache).
   ```json
   {"id": "example_overview", "name": "...", "source_type": "sql_database", "description": "...",
    "queries": [{"id": "total_tables", "title": "Total Tables",
                 "sql": "SELECT name FROM sqlite_master WHERE type='table'",
                 "chart_type": "bar", "chart_config": {"xKey": "...", "yKey": "..."}}],
    "layout": "single", "refresh_interval": 3600}
   ```
   `layout` is `single` or `grid_2x2`; `refresh_interval` is also the cache TTL. `{{table}}` in SQL fans out per
   table and unions the rows. `services/template_executor.execute_template` runs each query (SQL source via
   `create_engine`, file source loaded into in-memory SQLite as `data`), caps at `MAX_ROWS_FETCH = 500`, builds a
   chart spec with `_build_chart_spec` (xKey/yKey or first two columns), stores a `ReportTemplateRun`, and caches
   per `(source, template, filters)`. **No LLM in `/run`.**
3. **LLM-generated templates** (`routers/template_router.py`): `POST /templates/sources/{id}/generate` asks the LLM
   for `{name, description, queries[{title, sql, chart_type}], layout}` and saves a `ReportTemplate` row;
   `add-query`, `PATCH .../queries`, `customize` (user copy without disabled queries), `run-with-commentary`
   (one 2–3 sentence LLM insight per result on `rows[:10]`), and `run-report` (executive HTML analysis + per-result
   matplotlib PNG + 15-row table + explanation, saved as a `Report`).

## How to change things

- New built-in template: add a JSON file under `backend/app/templates/`, set `source_type` to the exact
  `Source.type`, write SQL for the dialect the executor will run (file sources → SQLite table `data`), use only
  `bar | horizontal_bar | line | pie` until the chart enum is extended end to end.
- New report stage: keep the profile deterministic, give the LLM the computed numbers (not just titles), validate
  any column it names against the profile, keep a deterministic fallback, log with a new `stage` value.
- New summary type: follow the probe-query pattern (LLM proposes, system caps with LIMIT, LLM writes from results).

## Known pitfalls in the current code

- `jira.json` queries use `"question"` instead of `"sql"`; the executor reads only `sql`, so they fail
  `_validate_select_only("")` and can never run. Add an explicit query kind before adding question templates.
- `_resolve_sql_placeholders` does raw string replacement with **every metadata key** plus request filters — a
  template can read `{{connectionString}}`, and filter values are injected into SQL. Use an allowlist of
  placeholders and bound parameters.
- `_validate_select_only` is a substring check: rejects `updated_at`/`deleted_at` columns and `WITH` CTEs.
- `_cache_key` ignores `date_range` and `disabled_queries` → stale results after changing them.
- `ReportTemplateRun.template_id` has a FK to `report_templates.id`, but JSON templates are never seeded there;
  PostgreSQL rejects the run row.
- `chart_type` values outside the four supported ones (`stacked_bar`, `histogram`, `scatter`) silently become
  `bar`; `groupKey`/`labelKey` are ignored. In `run-report`, scatter plots `ax.scatter(y_vals, y_vals)`.
- `sql_database.json` uses `pragma_table_info`, which only works on SQLite.
- Report HTML (`_assemble_html`, `_build_template_report_html`) interpolates column names, values and LLM HTML
  without escaping; `GET /reports/{id}/html` serves it raw. Escape data with `html.escape`.
- Row counts shown are sample sizes (5000 for reports; metadata `row_count` ≤ 1000 for uploads). CSV reports read
  the first 5000 rows (head-biased), only other sources get `df.sample(random_state=42)`.
- `_render_missing` color expression always picks `PALETTE[4]` (operator precedence).
- `template_router.py` loads template rows by id without a tenant filter; the run path never calls
  `unlock_source_metadata`.

## Checks before you finish

- `cd backend && pytest -q` and, for any new LLM stage, a unit test that mocks `chat_completion`/`record_log`.
- Render one report locally against a small CSV and open the HTML; confirm every chart and the language.

General version: `data-analytics:data-reports-and-alerts` in https://github.com/Empreiteiro/skills
