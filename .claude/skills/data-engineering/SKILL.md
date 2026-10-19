---
name: data-engineering
description: How the Data Talks data-engineering features work — medallion (bronze/silver/gold), ETL pipeline suggestions, runtime lineage, pipeline versioning with GitHub push, the CDP flow, AutoML and demo data — plus the live bugs in their routers. Use when touching medallion_*, etl_*, cdp_*, lineage.py, pipeline_versioning.py, pipeline_*_router.py, github_integration_router.py, data_engineering_router.py, automl*, or demo_data.py.
---

# Data engineering features

Shared shape: an LLM call returns JSON → lenient parse → stored in the app DB → SQL shown to the user.
**Nothing runs against client databases**, except CDP `/materialize` (LLM SQL on an in-memory SQLite built from
CSV sources) and AutoML (real scikit-learn training). There is no SQL parser in the backend.

## Medallion (`services/medallion_service.py`, `routers/medallion_router.py`, `MedallionPanel.tsx`)

Tables are named from the first 8 hex chars of the source id: `bronze_{sid}`, `silver_{sid}`, `gold_{sid}_{name}`.
Order is enforced: silver needs a ready bronze, gold needs a saved silver.

- **Bronze (`generate_bronze`) — deterministic, no LLM.** Every column `TEXT` (quotes doubled), plus
  `_loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `_source_file TEXT`, `_row_hash TEXT`. Replaces any earlier
  bronze row, writes `MedallionLayer(status="ready")` + `MedallionBuildLog(action="suggest")`, records a lineage
  `read` edge.
- **Silver (`suggest_silver` / `apply_silver`) — the good pattern: the LLM picks options, Python writes SQL.**
  `_SILVER_SYSTEM_PROMPT` restricts the model to closed vocabularies: `target_type` (INTEGER, REAL, TEXT, DATE,
  TIMESTAMP, BOOLEAN, DECIMAL), `transform` (`none|trim|lower_trim|remove_commas|strip_currency`),
  `null_strategy` (`KEEP_NULL|DROP_ROW|FILL_ZERO|FILL_DEFAULT`), `silver_name`, `dedup_key[]`, `dedup_order_by`.
  Input: column list, row count, profile of `df.head(1000)`, 3 sample rows; optional user feedback for "redo"
  (`action="redo"`). `_build_cast_expression` / `_build_silver_transform` / `_build_silver_ddl` compile the
  edited config into `INSERT INTO "silver_x" (...) SELECT ... FROM "bronze_x"` with `ROW_NUMBER()` dedup.
- **Gold (`suggest_gold` / `apply_gold`) — free-form LLM SQL.** 3–5 aggregate tables
  `{name, description, sql, dimensions, measures, explanation}`; optional "report goal" prompt; apply wraps each as
  `CREATE TABLE IF NOT EXISTS "gold_{sid}_{name}" AS <sql>;`.
- `_parse_json_response` strips fences, slices `{…}`, and returns `{}` on failure (silently).

## ETL (`services/etl_service.py`, `routers/etl_router.py`, `EtlPipelineModal.tsx`)

`suggest_pipeline` returns `{name, description, steps:[{id, name, type: extract|transform|load, source?,
depends_on?, sql, description}], schedule, explanation}`; `suggest_transform` returns one step (CSV table is
`data`). Pipelines live in `Agent.workspace_config["pipelines"]` (no ETL table) with id `pipeline_{n}`.
There is **no runner and no scheduler**. `build_lineage` derives a static graph from `depends_on`.

## Lineage (`services/lineage.py`, `routers/pipeline_runs_router.py`)

- `PipelineRun(kind, status running|success|error, duration_ms, error_message[:4000], metadata)` and append-only
  `LineageEdge(source_kind/ref, target_kind/ref, edge_type read|write|transform|derive)`; refs are strings so
  column-level lineage fits later.
- API: `start_run`, `record_edge`, `finish_run`, and the `tracked_run` context manager (exception → `status="error"`,
  re-raised). Instrumentation swallows its own errors: "lineage is observability, not an invariant".
- **No eager `flush()`** (b469ae0): on SQLite it opens a write transaction that blocks `record_log`'s separate
  session during the LLM call ("database is locked"). `run.id` is assigned client-side instead.
- `build_lineage_graph` dedups nodes by `"{kind}:{ref}"`. Call sites: medallion (read/transform/derive) and Q&A
  (`ask.py`, kind `qa`, `source -> agent`).

## Pipeline versioning (`services/pipeline_versioning.py`, `routers/pipeline_versions_router.py`)

- Immutable `PipelineVersion` rows, `version_number = max + 1` per `(agent_id, pipeline_id)`, `parent_version_id`,
  `restored_from_version_id`. Only the GitHub sha/url are updated after insert.
- `sanitize_snapshot` nulls any key matching `(?i)(key|secret|token|password|credential|private)` before storing,
  so a pushed version cannot leak secrets.
- `restore_version` is append-only: copy `workspace_config` and the pipelines list, replace the pipeline with a deep
  copy of the snapshot, reassign, then snapshot again as "Restored vN".
- `diff_versions` matches steps by `id` → `added_steps`, `removed_steps`, `changed_steps{fields:{a,b}}`, `top_level`.
- GitHub push: requires a `GithubConnection(user_id, organization_id)`, decrypts the token, **re-checks write access
  on every push** (`list_writable_repos`), writes `{base_path}/{agent}/{pipeline}/v{n}.json` with
  `json.dumps(..., indent=2, sort_keys=True)` via the Contents API, stores sha + html_url. OAuth state is
  in-memory, single-use, 10-minute TTL.

## CDP (`services/cdp_service.py`, `routers/cdp_router.py`)

Identity resolution, enrichment and segmentation are **LLM-only** (no normalization, no union-find): the model
sees each source's columns with top-2 sample values and returns a `join_key`, `source_mappings` and `silver_sql`;
then 5–8 metrics + `gold_sql`; then 4–6 segments with WHERE-fragment `rule_sql`. Results go to
`workspace_config`. `/materialize` loads every CSV source into `sqlite3.connect(":memory:")` with names from
`_make_table_name_from_source` (`crm_customers.csv` → `crm_customers`), strips a `CREATE TABLE … AS` prefix, runs
`pd.read_sql_query`, and saves the result as a new CSV `Source` appended to the agent.

## AutoML (`scripts/automl.py`, `routers/automl_router.py`)

`_detect_task_type`: numeric target is classification only if `nunique <= 20 and nunique/len < 0.05`; non-numeric
→ classification. `_prepare_data` drops all-null and constant features and null targets, needs ≥10 rows.
Pipeline: median impute + scale / most-frequent impute + one-hot (`max_categories=20`) → RandomForest (100 trees,
`random_state=42`), 80/20 split. Metrics: accuracy/precision/recall/F1 (weighted) + confusion matrix, or r2/mae/rmse;
top-15 feature importances. The LLM only explains the computed metrics (≤500 words, `action="automl"`).

## Demo data (`services/demo_data.py`, `POST /demo/create` in `crud.py`)

Unseeded `random`; analysis (sales/products/feedback), CDP (customers linked to orders/events by clean email only),
and ETL (access logs with deliberate blanks/`N/A`, inventory, shipping with ~15% blank delivery dates).

## Preferred patterns for new work

- Follow the silver model: closed vocabularies chosen by the LLM, validated server-side against real columns and
  enums, compiled to quoted SQL by Python. Avoid free-form LLM SQL (gold, ETL, CDP) where a spec would do.
- Put the real table names and dialect in every SQL-producing prompt; return "available tables" on errors.
- Make apply idempotent (upsert by name); link apply logs to the suggest log they came from.
- JSON columns: build a new dict/list and assign it (`dict(agent.workspace_config or {})`), as
  `restore_version` does, or call `flag_modified`.
- Pass `organization_id` explicitly to every lineage call.

## Known pitfalls in the current code

- **Live 500s (ruff F821):** `medallion_router.py` uses `tenant_filter` without importing it;
  `etl_router.py` and `data_engineering_router.py` reference undefined `scope`/`user` (left from the tenancy
  refactor). Every medallion, ETL-suggest and data-engineering-tools endpoint fails today.
- `pipeline_versions_router.py` registers `GET /{version_id}` before `GET /diff`, so `/diff` is unreachable;
  `require_role` is imported but unused (viewers can restore/push).
- ETL and CDP routers mutate `agent.workspace_config` in place and reassign the same object — changes after the
  first save may not persist. `pipeline_{len+1}` ids can be reused after a delete and inherit version history.
- `sanitize_snapshot` also nulls `dedup_key`, `join_key`, `primary_key`, `is_private`; restore then loses them.
- Medallion `tracked_run` calls omit `organization_id` (defaults to user id) so tenant-filtered run endpoints
  never show them; error runs are rolled back with the failed request.
- Gold apply never deletes earlier gold rows (duplicates); silver config is not validated server-side
  (`target_type` goes straight into `CAST`); DROP_ROW/dedup identifiers are not quote-escaped.
- Gold prompt says "standard SQL" but its example uses SQLite `strftime`; CDP prompts show `crm_customers.csv`
  while materialize runs against `crm_customers`.
- AutoML: no stratified split, no ID/leakage column checks, SQL sources read with no row cap, training runs
  synchronously in the async handler, `ValueError` becomes 500, and `_user_llm_overrides` is a divergent copy
  (use `resolve_agent_llm_overrides` from `routers/ask.py`). ETL and medallion also keep their own override helpers.
- No tests for medallion, ETL, CDP or the data-engineering tools.

## Checks before you finish

- `cd backend && ruff check --select F821 app && pytest -q tests/test_lineage.py tests/test_pipeline_versioning.py tests/test_automl.py`
- Exercise the endpoint you changed once through the API (the routers above have no tests).

General version: `data-analytics:medallion-pipeline`, `data-analytics:lineage-and-versioning`,
`data-analytics:identity-resolution`, `data-analytics:baseline-automl` in https://github.com/Empreiteiro/skills
