---
name: sql-sources
description: Text-to-SQL over SQL databases, uploaded SQLite files, BigQuery, Snowflake, dbt and multi-source SQL workspaces in Data Talks — metadata capture, prompts, the SELECT guard, row caps, cross-source materialization and table relationships. Use when touching `scripts/ask_sql*.py`, `ask_sqlite.py`, `ask_bigquery.py`, `ask_snowflake.py`, `ask_dbt.py`, `sql_utils.py`, `sql_relationships_llm.py` or the SQL/BigQuery/Snowflake/dbt routers.
---

# SQL sources

Read `qa-pipeline` first for the shared flow (context block, JSON contract, elaboration, follow-ups).

## How it works

### Metadata (captured once, stored in `Source.metadata_`, never re-introspected per question)
| Type | Capture | Stored shape / notes |
|---|---|---|
| `sql_database` | `POST /api/sql/tables` → `list_sql_tables_sync` (`sql_utils.py`) | Column **names only** (types, nullability, FKs discarded). Postgres: all non-system schemas, `schema.table` unless default schema. `SqlSourceForm.tsx` creates **one Source per selected table**: `{connectionString, databaseType, availableColumns, table_infos:[…]}` |
| `sqlite` (upload) | `_introspect_sqlite_sync` (`ask_sqlite.py`) | tables, `PRAGMA table_info`, 5 preview rows, `COUNT(*)`; bytes → hex ≤100 chars |
| `bigquery` | `_fetch_table_infos_sync`; `refresh-metadata` | column names only; previews only for the first table and never reach the prompt |
| `snowflake` | `DESCRIBE TABLE` + `LIMIT 5`; per-table `_error` | values made JSON-safe (datetime/Decimal/bytes) |
| `dbt` | manifest via GitHub contents API or dbt Cloud artifact (`ask_dbt.py`) | models/seeds/snapshots/sources; `description` captured but **dropped** by `ask_sql` |

Lazy introspection happens only when columns are missing (sqlite, bigquery, snowflake). No TTL or staleness check.

### Prompts
- `ask_sql`: "You may ONLY use the tables explicitly listed in the schema…", SELECT only in a fenced ```sql```
  block inside JSON, plus `Available tables ONLY (use no other): …`. Schema line: `Table {t}: columns [...]`.
  **No dialect is given** — `metadata.databaseType` (postgresql | mysql) is stored by the form but never read.
- `ask_bigquery`: standard SQL, full names `` `project.dataset.table` ``.
- `ask_snowflake`: Snowflake dialect, `"DATABASE"."SCHEMA"."TABLE"`.
- `ask_sqlite`: SQLite dialect.
- `ask_sql_multi`: tables are materialized into an in-memory SQLite; "use the provided table aliases"; infer JOINs
  from `*_id` names when no relationships exist. Section labels are Portuguese (`TABELAS E COLUNAS`, `PERGUNTA`).

### Execution guard and limits
- Guard = string tests: `query.strip().upper().startswith("SELECT")` + substring blacklist
  (`DELETE UPDATE INSERT DROP ALTER TRUNCATE`; sqlite also `CREATE`; snowflake: prefix check only, `WITH` allowed).
  Same pattern in `template_executor._validate_select_only`.
- Verified false positives: `updated_at`, `is_deleted`, `dropoff_zone`, any `WITH … SELECT` CTE (sql, bigquery,
  multi), a leading comment; sqlite also rejects `created_at`. False negatives: `SELECT 1; CREATE TABLE …`
  (no CREATE in the sql/bigquery lists), `SELECT … INTO new_table`.
- Rows: `fetchmany(500)` (`MAX_ROWS_FETCH`) in sql, multi, sqlite, snowflake. **BigQuery materializes every row**
  (`[dict(row) for row in job.result()]`, no `maximum_bytes_billed`, no dry run, no timeout).
- No LIMIT injection, no statement timeout, no read-only transaction/role, SQLite opened read-write. Safety today
  rests on accidents (SQLAlchemy rollback on close, sqlite3 single-statement `execute`).
- `create_engine(connection_string)` on every query and never disposed (`ask_sql._run_query_sync`,
  `summary_sql.py`, `template_executor.py`) — a leak per question.

### Multi-source (2+ `sql_database` sources)
- `_build_active_multi_sql_sources` (`ask.py`) counts all SQL sources, active or not; with validated
  relationships it keeps only the sources they mention.
- `_materialize_sources_to_sqlite` copies **every table in full** (`SELECT *`, no limit) into `:memory:` SQLite
  under aliases `src_<last8(source_id)>_<table>` (`_safe_alias`), quoting source identifiers with the dialect's
  `identifier_preparer`. This runs on every question, even in SQL mode; types degrade (dates → TEXT); the SQL
  shown to users references aliases they cannot run on their own database.
- Because the form creates one Source per table, two tables from the same database always take this path.

### Relationships
1. Heuristic `suggest_source_relationships`: identical column names (case-insensitive) across *different*
   sources — noisy (`id`↔`id`), misses `orders.user_id → users.id`.
2. LLM `suggest_source_relationships_llm` (`sql_relationships_llm.py`, `POST /sql/agents/{id}/suggest-relationships-llm`;
   POST so caches never hide token cost): caps 60 tables/source, 40 columns/table, 25 suggestions; parse → batch
   `validate_source_relationships`; on `ValueError` re-validate **one item at a time** so one hallucination does
   not blank the list; `reason` re-attached by `relationship_key`; errors degrade to `[]`.
3. `validate_source_relationships` requires the six fields, rejects self-loops and unknown
   source/table/column, dedupes both directions. `relationship_key` = `|`-joined six-tuple (matches the frontend).
   Dismissals live in `Agent.dismissed_relationship_suggestions`; saved ones in `Agent.source_relationships`
   via `PUT /sql/agents/{id}/relationships` (re-validated).

## How to change it (preferred pattern for new code)
1. **Guard with a parser, not substrings**: parse with sqlglot (add it to `pyproject.toml`), require exactly one
   statement whose root is SELECT/UNION/WITH, reject DDL/DML nodes and `SELECT … INTO`. Allow CTEs.
2. **Enforce read-only at the database**: read-only role or `SET TRANSACTION READ ONLY`, `statement_timeout`,
   SQLite `file:…?mode=ro` URIs, BigQuery dry run + `maximum_bytes_billed` + `job.result(timeout=…)`,
   Snowflake `STATEMENT_TIMEOUT_IN_SECONDS`. Wrap with a dialect-aware limit (`SELECT * FROM (<q>) t LIMIT n`).
3. **Tell the model the dialect** (pass `databaseType` through) and its quoting/case rules.
4. **Richer schema**: column types, declared FKs (`inspector.get_foreign_keys`), dbt descriptions, a few samples;
   budget by relevance for large warehouses.
5. **Bounded self-correction**: on a DB error or empty result, send SQL + sanitized error back for 1–2 retries.
6. Return the executed SQL as `sqlQuery` in the script result (only multi does today).
7. Reuse engines (cache per connection string, `pool_pre_ping`) and dispose on credential change.
8. Always run fenced SQL through `extract_sql_from_field` (multi and snowflake skip it).

## Known pitfalls in the current code
- `ask_sql_multi` reads `parsed.get("sqlQuery")` raw although its prompt demands a fenced block, so a fenced
  query fails `startswith("SELECT")` and is silently not executed.
- `ask_sqlite` and `ask_snowflake` ignore SQL mode for output (they only add "always include a SQL query" to the
  prompt, then execute and elaborate).
- Connection strings are not allowlisted: any member can register `sqlite:///./data_talks.db` (the platform DB by
  default) or an internal host via `POST /api/sql/tables`.
- `connectionString` is camelCase, so it is neither encrypted nor masked (see `tenancy-and-secrets`); the SQL form
  relies on reading it back.
- dbt uses `node.name` rather than the schema-qualified relation; only documented columns appear.
- Elaboration says "results from the full dataset" while it sees ≤50 of ≤500 rows and never the true total.
- `summary_sql._ensure_limit` appends `LIMIT 15` unless the text contains LIMIT/FETCH (wrong for MSSQL `TOP`).
- Only PostgreSQL has a driver in `pyproject.toml`; MySQL is offered in the UI but `pymysql` is not installed.

## Checks before you finish
- `cd backend && pytest -q` and `ruff check --select F821 app` (undefined names slipped through past refactors).
- Exercise a CTE, a column named `updated_at`, a 0-row query and a failing query against SQLite and Postgres.

General version: `data-analytics:text-to-sql` (also `join-discovery`) in https://github.com/Empreiteiro/skills
