---
name: file-sources
description: How Data Talks ingests and answers questions over file-like sources — CSV/XLSX/JSON/JSONL/Parquet/SQLite uploads, S3, GitHub files, Google Sheets, Excel Online, REST APIs and document stores (MongoDB, Firebase, Notion) — including storage, profiling, the dataframe→SQLite path and the pandas-exec path. Use when changing `routers/crud.py` upload code, `services/storage.py`, `scripts/ask_csv.py`, `ask_s3.py`, `ask_google_sheets.py`, `ask_excel_online.py`, `ask_github_file.py`, `ask_rest_api.py`, `ask_mongodb.py`, `ask_firebase.py` or `ask_notion.py`.
---

# File and document sources

Read `qa-pipeline` for the shared flow. This skill covers loading, profiling and execution.

## How it works

### Upload: `POST /api/sources/upload` (`upload_source` in `routers/crud.py`)
- Extension allowlist: `csv xlsx xls db sqlite sqlite3 parquet json jsonl` (matches `accept=` in
  `src/components/UploadSourceForm.tsx`).
- Key `f"{user_id}/{uuid4().hex}.{ext}"`; `storage.write_bytes(path, await file.read())` **before** parsing, whole
  file in memory, **no size limit**. A parse error 500s and orphans the stored object.
- Parsing samples 1000 rows for metadata only:
  - CSV `pd.read_csv(full, nrows=1000)` — UTF-8 + comma only (a `;` file becomes one column, Latin-1 raises),
    no `decimal=","` (matters for pt-BR data).
  - Parquet reads the whole file, then `.head(1000)`. JSONL `read_json(lines=True, nrows=1000)` → type `json`.
  - JSON: list → `json_normalize`; dict → first list under `data|results|items|records`, else one row; scalar →
    `{"value": …}`.
  - XLSX/XLS `read_excel(nrows=1000)`: **first sheet only**; `xlrd` is not installed, so `.xls` fails.
  - SQLite files → `_introspect_sqlite_sync` (see `sql-sources`), type `sqlite`.
- `upload_file_source` in `mcp_server.py` duplicates this logic — change both or extract a shared helper.

### Metadata shape (`Source.metadata_`)
```
{file_path, columns, preview_rows (5, _sanitize_for_json'd), row_count, sample_row_count,
 sample_profile: {sample_rows, columns: {col: {type, missing, numeric:{min,max,mean,median} | top_values (top 3)}}}}
```
- `_build_sample_profile` (crud.py) dedupes duplicate column names first ("avoid DataFrame returned instead of
  Series"); `ask_csv` has its own copy without that fix. No `nunique`, no datetime detection.
- `_sanitize_for_json`: NaN/inf → None, numpy scalars → `.item()`, dates → ISO, Decimal → float.
- `row_count` is the **sample size** (≤1000), not the file size; summaries then report "Total rows: 1000".
  `services/demo_data._build_metadata` stores the real count — follow that.
- `sample_profile.top_values` seeds onboarding category filters, so profile quality is load-bearing.

### Storage (`app/services/storage.py`)
- `get_storage()` singleton: `S3Storage` when `S3_BUCKET` is set (S3 is the source of truth, `data_files_dir`
  is a lazy cache), else `LocalStorage`. Keys are relative POSIX paths.
- Contract: `storage.local_path(key)` always returns a filesystem path so pandas/sqlite3 work unchanged; on S3 it
  downloads lazily and returns a non-existent path on failure (callers check `.exists()`).
  `LocalStorage._abs` rejects path traversal. Never concatenate `data_files_dir` yourself. Tests:
  `tests/test_storage.py`.

### Question time — dataframe → in-memory SQLite (csv, s3, rest_api, google_sheets, excel_online, github_file)
- `ask_csv._load_full_dataframe` dispatches by **file extension** (that is why JSONL works with type `json`),
  caps at `MAX_CSV_ROWS = 100_000`, and reloads + re-profiles the file on **every question** (sync, blocks the loop).
- `df.to_sql("data", sqlite3.connect(":memory:"))`. Other active file sources become extra tables named by
  `_make_table_name` (collision → `_2`); the primary is then renamed too, while the system prompt still says
  "loaded in a table named 'data'".
- Prompt rules: precise filtering/counting/aggregation **must** come with `sqlQuery`; quote columns with spaces;
  `Total rows` is the post-cap count (silent truncation).
- Guard: `startswith("SELECT")` + substring blacklist incl. `CREATE` (rejects `created_at`, `updated_at`,
  `is_deleted`, CTEs). `ask_s3`/`ask_rest_api`: prefix check only. **`ask_excel_online._run_sql_on_df` has no
  guard** (`ATTACH DATABASE` would create files). Results: `fetchall()` (csv, s3, rest) vs `fetchmany(500)`.

### Connector specifics
- **S3**: boto3 with optional user-supplied `endpoint` (MinIO; also an SSRF vector); whole object downloaded per
  question, no byte cap; listing offers csv/json/jsonl/parquet only (≤500 objects).
- **GitHub file**: `raw.githubusercontent.com`, csv/tsv/json/ndjson; uses `pd.DataFrame` (no normalize), so nested
  dicts stay objects.
- **Google Sheets**: one platform service account from env `GOOGLE_SHEETS_SERVICE_ACCOUNT` (users share the sheet
  with its email); `get_all_values()` → **every value is a string** → TEXT columns, so `MAX`/`ORDER BY` are
  lexicographic and `SUM('1,234.50')` is silently wrong. `gspread` is in `requirements.txt` but not `pyproject.toml`.
- **Excel Online**: Graph `usedRange`; raw `accessToken` without refresh; **dates arrive as Excel serial numbers**;
  blanks turn columns into object/TEXT.
- **REST API** (`ask_rest_api.py`): `dataPath` dot-walk; pagination `offset|page|cursor` with `max_pages=100`,
  `MAX_API_ROWS=50_000`; `json_normalize` keeps **lists**, and `df.to_sql` then fails before the LLM call.

### Pandas-exec path (MongoDB, Firebase, Notion)
- LLM returns `pandasCode`; data is fetched lazily only then (`find({}, limit=10000)`, no projection/filter).
- `_run_pandas_code`: builtins reduced to `len, range, … print` plus `pd`; `exec` all but the last line, `eval`
  the last; on any exception re-run `exec(code)` and return `safe_globals.get("result")`.
  **This is not a sandbox** (`pd.read_csv('/etc/…')`, `().__class__.__subclasses__()`), has no timeout, runs side
  effects twice on fallback, and the prompt never mentions `result`.
- `_result_to_rows`: DataFrame/Series → `head(500)` records; only Python `int/float/str/bool` scalars count, so a
  `numpy.int64` result → `None` → no elaboration.
- MongoDB schema shows top-level keys only, but the frame has `a.b` columns after `json_normalize`.

## How to change it (preferred pattern for new code)
1. One loader + one profiler shared by upload, ask, MCP, summary and report (today they are copies).
2. Parse before persisting (or delete on failure) and enforce an upload byte limit.
3. Sniff encoding (utf-8, utf-8-sig, latin-1/cp1252) and delimiter (`csv.Sniffer`); support decimal comma; let the
   user pick the Excel sheet.
4. Coerce types before `to_sql`: strip currency/thousands separators, parse dates (incl. Excel serials), and tell the
   LLM the coerced types.
5. Flatten fully: dicts → dotted columns, lists → `json.dumps` (the `_flatten` in `ask_intercom.py`) or child tables.
6. Store the true row count separately from the sample size and disclose truncation in prompt and answer.
7. Prefer SQL over `exec`. If pandas code must run, run it in a subprocess with time/memory limits, require a
   `result` variable, and convert numpy scalars.
8. Return `sqlQuery`/`pandasCode` in the result so the generated-query panel works.

## Known pitfalls in the current code
- REST SSRF check is dead code: the private-IP `ValueError` is raised inside `try … except ValueError: pass`
  (`_validate_url`), so `10.0.0.5`, `169.254.169.254`, `127.0.0.2` pass. Only literal hostnames are blocked.
- REST `page` pagination increments twice per loop → requests pages 2, 4, 6…
- `pagination`, `queryParams` and `body` exist in the backend but not in `RestApiSourceForm.tsx`.
- S3/Mongo/Excel/REST secrets are camelCase, so they are stored and returned in plaintext (see `tenancy-and-secrets`).
- Error notes appended to answers are Portuguese (`*Erro ao executar a consulta SQL: …*`).
- `report_csv` reads `nrows=5000` (head-biased) before the report sampler ever runs.

## Checks before you finish
- `cd backend && pytest -q tests/test_storage.py` plus the full suite.
- Upload a `;`-separated Latin-1 CSV, a JSON with array fields, an XLSX with two sheets and a Parquet file; ask a
  `SUM` and a `MAX` question on each.

General version: `data-analytics:tabular-file-qa` (also `dataset-profiling`) in https://github.com/Empreiteiro/skills
