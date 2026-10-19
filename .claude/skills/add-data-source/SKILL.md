---
name: add-data-source
description: Checklist and connector anatomy for adding a new data source type (database, file store or SaaS/API integration) to Data Talks — ask script, dispatcher branch, create-source validation, router with test-connection/discover/refresh, secret keys, frontend form and API client. Use when adding a connector, fixing a SaaS integration (`ask_stripe.py`, `ask_hubspot.py`, `ask_jira.py`, …) or reviewing one.
---

# Add a data source

There is no shared connector base: every `scripts/ask_<vendor>.py` is a standalone copy (the 2026 integrations
came from auto-generated PRs, see commit 1a16c6f). Copy from the best example, not the nearest one.
Best references: `ask_jira.py` (typed DDL, child tables), `ask_intercom.py` (`_flatten`), `ask_stripe.py`
(catalog + discover with per-table `_error`), `ask_shopify.py` (child tables with FK).

## Wiring checklist (every item, or the source is dead somewhere)
1. **Script** `backend/app/scripts/ask_<type>.py` exposing
   `async def ask_<type>(<creds…>, question, agent_description="", source_name=None, table_infos=None,
   llm_overrides=None, history=None, channel="workspace", sql_mode=False) -> dict`.
2. **Create validation**: add the type to `valid_types` in `create_source` (`routers/crud.py`). The 12 "lite"
   connectors (aws_costs, google_ads, meta_ads, mercado_pago, mercado_livre, mixpanel, mailchimp, linkedin_ads,
   zendesk, youtube, instagram, rdstation) are missing here, so their forms get HTTP 400.
3. **Dispatcher**: an `elif source.type == "<type>"` branch in `dispatch_question` (`routers/ask.py`) passing
   `agent_description=_description_for(agent)` — not `_build_agent_description(agent)`, which drops KPIs,
   clarifications and source instructions.
4. **Router** `routers/<type>_router.py` (`APIRouter(prefix="/<type>")`), registered in `main.py` with
   `app.include_router(<type>_router.router, prefix=prefix)`:
   - `POST /<type>/test-connection` — cheapest authenticated call (`/me`, `/balance`, `LIMIT 1`); return account info.
   - `POST /<type>/discover` — catalog with counts/previews and a per-table `_error` instead of failing the batch.
   - `POST /<type>/sources/{source_id}/refresh-metadata` — load with `tenant_filter(Source, scope)`, decrypt with
     `unlock_source_metadata` **on a copy**, write `table_infos`, return **masked** metadata
     (`mask_secret_fields`). Use `require_role("member")` for writes.
5. **Secrets**: every credential key must be in `SOURCE_SECRET_KEYS` (`services/crypto.py`). Matching is
   `k.lower() in keys` against snake_case names, so camelCase keys (`apiKey`, `accessToken`, `apiToken`,
   `connectionString`, `credentialsContent`, `integrationToken`, `token`) are **not** encrypted or masked today.
   Use snake_case keys for new connectors or fix the matcher first (see `tenancy-and-secrets`).
6. **Metadata shape**: store tables as `table_infos: [{table, columns, preview_rows, row_count}]`
   (`sql_utils.normalize_table_infos`). Onboarding (`_build_source_profile`) only reads
   `tables | table_infos | columns | schema | preview_rows | sample_profile | row_count`; count-only metadata
   (`objectCounts`, `resourceCounts`) gives it nothing to work with.
7. **Frontend**: `src/components/<Type>SourceForm.tsx` (React Hook Form + Zod, `t()` strings in PT/EN/ES), API
   methods in `src/services/apiClient.ts` whose TypeScript types match the router's real response
   (GA4, Shopify and GitHub discover responses drift today), `catch (error: unknown)`, no `any`.
8. **Return contract** from the script: `{answer, imageUrl: None, followUpQuestions, chartInput, sqlQuery}`.

## Connector anatomy (SaaS/API)
- **Table catalog constant** = the schema contract: logical table → endpoint/records key/columns/notes.
  Examples: `STRIPE_TABLE_FIELDS`, HubSpot `_OBJECT_PROPERTIES` (+ association tables), Salesforce `_OBJECT_FIELDS`
  (→ SOQL), `GA4_TABLES` (dimensions/metrics per report), Jira explicit DDL in `_create_tables`.
  Put units in the catalog and the prompt ("Stripe amounts are in cents", "timestamps are epoch seconds").
- **Auth styles**: Bearer (Stripe, HubSpot, Salesforce, Intercom/GitHub/Notion + version header), custom header
  (Shopify `X-Shopify-Access-Token`), Basic (Jira `email:api_token`, Zendesk, Mailchimp), service-account JWT →
  token (GA4, no Google SDK), refresh-token grant (Google Ads), boto3 (AWS). Avoid tokens in query strings
  (Pipedrive, Meta Ads): httpx error strings include the URL and leak them.
- **Pagination** (one per vendor):

  | Style | Example |
  |---|---|
  | last-id cursor + `has_more` | Stripe `starting_after` |
  | cursor in body/`paging.next.after` | HubSpot, Notion `next_cursor` |
  | next URL | Salesforce `nextRecordsUrl` |
  | `Link: rel="next"` | Shopify, GitHub (`_parse_link_header`) |
  | offset + total / `isLast` | Jira `_paginate_jira` / `_paginate_agile` |
  | offset + `more_items_in_collection` | Pipedrive |

  Caps: 10k (Stripe) to 50k rows (`MAX_ROWS`), or `max_pages`. No connector handles 429/`Retry-After`.
- **Flattening**: prefer `_flatten` from `ask_intercom.py` — nested dicts → dotted keys, lists/tuples →
  `json.dumps(v, default=str)`. `pd.json_normalize` alone keeps lists, and `df.to_sql` then raises
  (Stripe `items.data`, Pipedrive `email`/`phone`). For one-to-many arrays create child tables with the parent key
  (Shopify `line_items.order_id`, Jira worklogs/changelogs).
- **Load + ask**: build `sqlite3.connect(":memory:")` in the same thread (or a temp-file DB when work crosses
  executor threads — `:memory:` is private per connection), `to_sql` each table, schema text with row counts and
  3 sample rows, then the standard JSON contract and elaboration (see `qa-pipeline`).

### Module skeleton
```python
VENDOR_API_BASE = "https://api.vendor.com/v1"
MAX_ROWS = 50_000
VENDOR_TABLES = {  # schema contract
    "deals": {"path": "/deals", "records_key": "data", "pagination": "cursor",
              "columns": ["id", "amount", "stage", "created"], "notes": "amount in cents"},
}
def _headers(creds: dict) -> dict: ...
def _test_connection_sync(creds: dict) -> dict: ...                  # {"ok": True, "account": ...}
def _paginate_sync(client, url, headers, params, records_key, max_records) -> list[dict]: ...  # + 429 backoff
def _flatten(record: dict) -> dict: ...                              # scalars only; list/dict -> json.dumps
def _discover_sync(creds: dict, tables: list[str] | None) -> list[dict]: ...   # table_infos shape, _error per table
def _load_tables_sync(creds: dict, tables: list[str]) -> dict[str, "pd.DataFrame"]: ...
async def ask_vendor(..., history=None, channel="workspace", sql_mode=False) -> dict: ...
```

## Known pitfalls in the current code
- Lite connectors call `elaborate_answer_with_results(question, answer, rows, …)` and
  `refine_followup_questions(follow_ups, columns, question, …)` positionally with the wrong argument order; the
  exception is swallowed, so rows never reach the answer and follow-ups become column names. **Always call these
  helpers with keyword arguments.**
- Lite connectors do `messages.extend(history[-5:])`; history items are QA entries (`{id, question, answer, …}`),
  not `{role, content}`. Build user/assistant pairs like `ask_sql.py`.
- Per-table fetch errors are swallowed into empty DataFrames (`ask_hubspot.py`), turning auth or throttling
  failures into confident wrong answers. Log and surface `_error`.
- `refresh-metadata` endpoints return `{"metaJSON": source.metadata_}` unmasked and never call
  `unlock_source_metadata` (they only work because camelCase secrets were never encrypted).
- Metadata key drift: GA4 router writes `table_infos`, dispatcher reads `tableInfos`; GitHub writes `schema_text`,
  dispatcher reads `schemaText`/`tablesData`.
- Intercom passes `params=params if page == 0 else None`, dropping the `starting_after` cursor → page 1 repeated.
- Every question re-fetches the whole API dataset (no cache/TTL); Intercom discover fully fetches to count.
- Gen A scripts only execute `startswith("SELECT")` (CTEs skipped); none return `sqlQuery`.
- Pinned API versions (Shopify `2024-01`, Salesforce `v59.0`, Google Ads `v16`, Meta `v19.0`) with no refresh path;
  Salesforce tokens are never refreshed.

## Checks before you finish
- `cd backend && pytest -q && ruff check --select F821 app`; `npm run typecheck && npm run lint`.
- In `make dev`: create the source through the form, run test-connection, discover, refresh, then ask two questions
  (one per catalog table) and confirm `GET /api/sources` shows `{"present": true}` for every secret.

General version: `data-analytics:api-data-connector` in https://github.com/Empreiteiro/skills
