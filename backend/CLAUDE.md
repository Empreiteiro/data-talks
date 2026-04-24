# CLAUDE.md — Backend (FastAPI)

## Running

```bash
uv pip install -e .          # Install backend as editable package
uv run data-talks run        # Start server on http://localhost:8000
cd backend && uv run alembic upgrade head   # Run migrations
cd backend && pytest         # Run tests
```

## Architecture

### Request Flow
1. Client sends request → FastAPI router handles it
2. Router extracts current user via `Depends(require_user)` (JWT) or `Depends(get_api_key_user)` (API key)
3. Router gets DB session via `Depends(get_db)`
4. For Q&A: router dispatches to `app/scripts/ask_<source_type>.py` based on the source type
5. Script builds prompt, calls LLM via `app/llm/client.py`, executes generated code, returns result
6. Charts generated with matplotlib, saved as images, served via static endpoint

### Key Files
- `app/main.py` — App factory, middleware, router registration, static file mounting
- `app/models.py` — All SQLAlchemy models (User, Source, Agent, QASession, Dashboard, etc.)
- `app/schemas.py` — Pydantic models for API request/response validation
- `app/database.py` — Async engine, session factory, `get_db` dependency
- `app/auth.py` — JWT creation/verification, `require_user`, `require_admin`
- `app/config.py` — Pydantic Settings loaded from `backend/.env`

### Routers (`app/routers/`)
- `ask.py` — Main Q&A endpoint, dispatches to source-specific scripts
- `auth_router.py` — Login, register, current user
- `crud.py` — CRUD for sources, agents, dashboards
- `settings_router.py` — User settings, LLM config
- `public_api_router.py` — External API (`POST /api/v1/ask`) with API key auth
- Other routers: `bigquery_router`, `sql_router`, `telegram_router`, `whatsapp_router`, `alert_router`, `report_router`, `automl_router`, `webhook_router`, `dbt_router`, `github_router`

### Scripts (`app/scripts/`)
Each source type has its own Q&A script:
- `ask_csv.py` — CSV/XLSX file analysis (loads into pandas)
- `ask_sql.py` — Single SQL database queries
- `ask_sql_multi.py` — Multi-source SQL with cross-database joins
- `ask_bigquery.py` — BigQuery table analysis
- `ask_google_sheets.py` — Google Sheets integration
- `ask_dbt.py` — dbt model queries
- `ask_github_file.py` — GitHub file analysis

Summary scripts follow the pattern `summary_<type>.py`.

### LLM Module (`app/llm/`)
- `client.py` — Provider-agnostic LLM client (OpenAI, Ollama, LiteLLM)
- `charting.py` — Chart planning and matplotlib code generation
- `elaborate.py` — Answer elaboration/expansion
- `followups.py` — Follow-up question suggestion

**Always use `app/llm/client.py`** — never import the OpenAI SDK directly in routers or scripts.

## Database Conventions

- All IDs are UUID v4 strings (generated with `uuid.uuid4()`).
- Async operations only: use `await session.execute(...)`, never synchronous calls.
- Multi-tenancy: `Organization` + `OrganizationMembership` (N-to-N). Tenant-scoped models carry `organization_id NOT NULL`. `User.organization_id` is an optional "last active" hint, not the authoritative scope.
- Fixed IDs: `GUEST_USER_ID` and `ADMIN_USER_ID` constants in `models.py`. The guest user is auto-enrolled as `owner` of a `Guest` org on migration.
- Tenant scope resolution (see `app/auth.py:require_membership`): `X-API-Key` → key's `organization_id`; otherwise JWT `org_id` claim; else guest fallback.
- Role hierarchy: `viewer (0) < member (1) < admin (2) < owner (3)`. Use `Depends(require_role("admin"))` when writes should be restricted.
- Secrets in `Source.metadata_` and bot tokens are Fernet-encrypted at rest; `app/services/crypto.py` provides `encrypt_secret_fields`, `unlock_source_metadata`, and the `EncryptedText` SQLAlchemy type.

## Adding New Features

### New API endpoint on a tenant-scoped model
1. Create or extend a router in `app/routers/`.
2. Add Pydantic schemas in `app/schemas.py`.
3. Register the router in `app/main.py` if it's a new file.
4. Protect with `Depends(require_membership)` (read) or `Depends(require_role("member"/"admin"))` (write/delete).
5. Filter every SELECT/UPDATE/DELETE with `tenant_filter(Model, scope)` from `app.services.tenant_scope`.
6. On INSERT, set `organization_id=scope.organization_id`.

### New API endpoint on a user-personal model (LlmConfig, QASession, ...)
1. Keep `Depends(require_user)` + `Model.user_id == user.id` filters.
2. Do not use `tenant_filter` — it raises if the model has no `organization_id` column.

### New data source type
1. Create `app/scripts/ask_<type>.py` following the pattern of existing scripts.
2. Add the source type to the `Source` model's type enum/validation.
3. Update the dispatcher in `app/routers/ask.py`.
4. Create corresponding frontend form component.

### New database table/column
1. Add/modify the model in `app/models.py`.
2. Generate migration: `cd backend && uv run alembic revision --autogenerate -m "description"`
3. Apply: `cd backend && uv run alembic upgrade head`
4. Always test with both SQLite and PostgreSQL if possible.

## Testing

- Tests in `backend/tests/` using pytest.
- Use `conftest.py` fixtures for DB session and test client.
- Test files: `test_auth_api.py`, `test_auth_utils.py`, `test_automl.py`, `test_health.py`, `test_schemas.py`.
- Run: `cd backend && pytest` or `cd backend && pytest -v` for verbose output.
