---
name: tenancy-and-secrets
description: Multi-tenancy, roles, API keys and encryption at rest in Data Talks — TenantScope, require_membership/require_role, tenant_filter, the AST tenancy lint, Fernet envelopes, EncryptedText, masking — and the verified gaps (camelCase secrets never encrypted, decrypt write-back, unscoped MCP/public API/scheduler paths). Use when adding or changing any endpoint, model, background job or channel that reads tenant data or stores credentials.
---

# Tenancy and secrets

## Model

- `Organization` + `OrganizationMembership(organization_id, user_id, role)` (unique per pair). Roles ascend
  `viewer (0) < member (1) < admin (2) < owner (3)` (`ROLE_HIERARCHY` in `models.py`).
- `User.organization_id` is only a "last active" hint — never use it as the scope.
- Guest mode (`ENABLE_LOGIN=false`, default): the fixed `GUEST_USER_ID` is `owner` of a `Guest` org, so the same
  scoping code runs in dev.

## Resolving the scope (`app/auth.py`)

`require_membership` returns `TenantScope(user, organization_id, role)`, in this order:

1. `X-API-Key` → sha256 lookup, `is_active`, the key's `organization_id`, and the owner must still be a member.
2. Bearer JWT → `org_id` claim must match a membership (403 otherwise); no claim → first membership by
   `created_at`. `POST /auth/switch-org` issues a new token.
3. Guest fallback when login is disabled.

`require_role("member" | "admin" | "owner")` wraps it and returns 403 below the minimum.

## Writing an endpoint

Tenant-scoped models (Source, Agent, QASession, Dashboard, Alert, PipelineRun, ApiKey, …):

```python
@router.get("/sources/{source_id}")
async def get_source(source_id: str, db: AsyncSession = Depends(get_db),
                     scope: TenantScope = Depends(require_membership)):
    r = await db.execute(select(Source).where(Source.id == source_id, tenant_filter(Source, scope)))
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")   # 404, not 403: don't leak existence
```

- Reads: `require_membership`. Create/edit: `require_role("member")`. Delete: `require_role("admin")`.
- Every SELECT/UPDATE/DELETE: `tenant_filter(Model, scope)` (from `app.services.tenant_scope`). It **raises**
  on models without `organization_id` — that is intentional.
- Every INSERT: `organization_id=scope.organization_id`.
- IDs stored inside JSON (`agent.source_ids`, `alert.agent_id`) must be checked against the tenant when written
  and filtered again when loaded.
- User-personal models (LlmConfig, Webhook, bot configs, QA history ownership): keep `require_user` /
  `scope.user.id` and filter by `user_id`; do not call `tenant_filter` on them.
- Background jobs, bots, MCP and the public API must build the same scope (org + role) instead of loading rows by
  id. These are where the leaks are (see pitfalls).

## The tenancy lint (`tests/test_tenancy_lint.py`)

AST scan of `backend/app`: every `select(<Model>)` chain for a model in `TENANT_SCOPED_MODELS` must contain
`tenant_filter(<Model>, …)` or `<Model>.organization_id == …` in a `where/filter/filter_by` call.
`ALLOW_FILES` exempts whole files with a reason; `test_allowlist_stays_minimal` caps it at 14 (13 today).

Write queries so the lint can see them: put the tenant predicate in the first `.where(...)` of the inline chain.
Blind spots: `db.get(Model, id)`, `update()`/`delete()`, `select(func.count(...))`, queries built in steps
(`q = select(X); q = q.where(...)` is flagged), any right-hand side (`== agent.organization_id` passes), and
models missing from the list (SourceClarification, SourceGroup, SourceWarmup, SourceFilter, OrganizationKpi,
ReportTemplate*). When you add an org-scoped model, add it to `TENANT_SCOPED_MODELS`.

## Encryption at rest (`app/services/crypto.py`)

- Key: `GITHUB_TOKEN_ENCRYPTION_KEY` if set, else HKDF-SHA256(`SECRET_KEY`, salt `data-talks:v1`) →
  `get_fernet()` (cached). One global key; no rotation support.
- `Source.metadata_`: `encrypt_secret_fields` wraps values whose key (lowercased) is in `SOURCE_SECRET_KEYS` as
  `{"__enc": "<fernet>"}`; `decrypt_secret_fields` / `unlock_source_metadata` unwrap; `mask_secret_fields`
  returns `{"present": true}` for API responses. Only `crud.create_source` encrypts.
- Scalar columns: `EncryptedText` TypeDecorator (bot tokens, Slack secrets, `claude_code_oauth_token`). Values
  starting with `gAAAA` pass through on write; legacy plaintext passes through on read; a decrypt failure returns
  the raw value instead of raising.
- GitHub OAuth tokens: explicit `*_enc` columns with `encrypt_text`/`decrypt_text`.
- Fernet is randomized, so you cannot `WHERE token = :plain`; dedupe in Python (see `telegram_router.py`) or add a
  keyed-hash column. Ciphertext is longer than the plaintext — size `VARCHAR` columns for it (PostgreSQL enforces).
- Encrypting existing rows: write an idempotent data migration like
  `alembic/versions/20260413130000_encrypt_existing_secrets.py` (skip `gAAAA…`/`__enc` values, handle JSON as str
  on SQLite and dict on PostgreSQL, keep a snapshot copy of the key list, downgrade is a documented no-op).

## API keys (`routers/api_keys_router.py`)

`dtk_` + `secrets.token_urlsafe(48)`; store sha256 `key_hash` and `key_prefix = raw[:12]`; return the raw key once.
A key is bound to an agent and (by schema) an organization.

## Known pitfalls in the current code (verified)

- **camelCase secrets are never encrypted or masked.** `SOURCE_SECRET_KEYS` is snake_case
  (`connection_string`, `api_key`, `access_token`, …) but forms and scripts use `connectionString`, `apiKey`,
  `accessToken`, `apiToken`, `token`, `credentialsContent`, `secretAccessKey`, `integrationToken`. Those values are
  stored in plaintext and returned by `GET /api/sources`; `SqlSourceForm` / `BigQuerySourceForm` currently depend on
  reading them back. Fixing the key list requires: normalizing key matching, a data migration, `unlock_source_metadata`
  in every reader (refresh-metadata routers, alert scheduler, reports, templates, AutoML), and a frontend that no
  longer needs the plaintext.
- **Decrypt write-back.** `unlock_source_metadata` assigns decrypted metadata onto the session-attached ORM row and
  `dispatch_question` commits → any encrypted secret is persisted back as plaintext. Decrypt into a copy and pass
  it to the script.
- ~20 `refresh-metadata` endpoints return `{"metaJSON": source.metadata_}` unmasked.
- Allowlisted files with real holes: `mcp_server.py` (`ask_question`/`list_sources` load Agent/Source/QASession
  by id, no org filter; role never checked; `upload_file_source` reads arbitrary server paths),
  `public_api_router.py` (`get_api_key_user` has no membership check; sources/history loaded without tenant
  filter), `alert_scheduler.py` (agent/sources/LlmConfig by id), `audit_router.py` (`AuditLog` has no
  `organization_id`; any user can read/export/purge).
- `create_api_key` never sets `organization_id` (NOT NULL) → creation fails; `scopes=["ask"]` is never enforced, so
  a key is a full credential on every `/api/*` route; viewers can mint keys and create alerts.
- Plaintext columns: `LlmConfig.*_api_key`, `Webhook.secret`. MCP `create_source` skips `encrypt_secret_fields`.
- `SECRET_KEY` defaults to `change-me-in-production` with no boot guard, and signs JWTs too: rotating it makes every
  stored secret unreadable. Prefer an explicit `GITHUB_TOKEN_ENCRYPTION_KEY`.
- Refactor lesson: the `user → scope` sed rename produced `NameError: user` three times (6c53c98, b469ae0,
  0769a14) and still breaks `etl_router.py`, `data_engineering_router.py`, `medallion_router.py`; the bots pass a
  `User` positionally where `ask_question` expects a `TenantScope`. Run `ruff check --select F821 app` and keep
  type hints on signatures so callers fail at check time.

## Checks before you finish

- `cd backend && pytest -q tests/test_tenancy.py tests/test_tenancy_lint.py tests/test_crypto.py`
- New endpoint: add a cross-org test (two orgs, one user in both) asserting 404 on GET/PATCH/DELETE, and a role
  test asserting 403 for the role below the minimum.
- New credential field: assert the stored row holds `{"__enc": …}` and the API response is masked, using the exact
  payload the frontend sends.

General version: `data-analytics:secure-data-platform` in https://github.com/Empreiteiro/skills
