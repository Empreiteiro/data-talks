---
name: backend-testing
description: How to run and write tests for Data Talks — pytest setup and its conftest gotchas, the two-tenant IDOR fixture, role-gate tests, mocking LLM calls, pure-helper tests, the tenancy lint — plus the extra checks CI does not run (ruff F821, router import smoke test, real-payload secret masking). Use before committing backend or frontend changes, when adding tests, or when the suite fails with "no such table" or stale-session errors.
---

# Backend (and frontend) testing

## Running

```bash
cd backend && pytest -q                      # asyncio_mode = auto (pytest.ini); tests in backend/tests/
cd backend && pytest -q tests/test_tenancy.py -k idor
npm run typecheck && npm run lint && npm test   # frontend: tsc, ESLint, Vitest (src/__tests__/)
```

CI (`.github/workflows/ci.yml`) installs with `pip install -e .` + `requirements-test.txt` (pyproject is the
dependency source of truth — `requirements.txt` drifted, bd06ca9) and runs pytest with
`DATABASE_URL=sqlite+aiosqlite:///:memory:`, `ENABLE_LOGIN=false`, `SECRET_KEY=ci-test-secret-key`. The frontend job
runs typecheck, lint, Vitest. CI has no ruff/mypy, no PostgreSQL, and never runs `alembic upgrade head`.

## Conftest gotchas (241aa95 — the suite had silently never run)

`backend/tests/conftest.py` already handles these; keep them in mind when adding fixtures or a second engine:

- aiosqlite gives **each connection its own private `:memory:` database**, so the schema created by `create_all`
  was invisible to request connections. The suite uses a temp-file SQLite instead (`TEST_DATABASE_URL`).
- `import app.models` **before** `Base.metadata.create_all`, or the metadata is empty and no tables exist.
- `from app.database import AsyncSessionLocal` creates a binding, not an alias. The `app` fixture rebinds
  `engine`/`AsyncSessionLocal` in `app.database` **and** in `app.main`; any new module that captures them at import
  time needs the same patch.
- httpx `ASGITransport` does not run the lifespan, so the fixture calls `_ensure_single_user()` itself (seeds the
  guest/admin user, org and owner membership). Background workers are deliberately not started.
- Env vars (`DATABASE_URL`, `ENABLE_LOGIN`, `SECRET_KEY`) are set before importing the app; `get_fernet()` is
  `lru_cache`d, so call `cache_clear()` if a test changes the key.

## Patterns to copy

- **Cross-tenant (IDOR) tests** — `tests/test_tenancy.py::two_tenants` seeds org A and org B, a user in both
  (`member` in A, `viewer` in B), one Source and one Agent per org. Authenticate with a JWT carrying `org_id`
  (`_token_for(user_id, org_id)`), then assert **404** (not 403) for GET/PATCH/DELETE on the other org's ids and that
  lists exclude them.
- **Role gates** — viewer → 403 on create, member → 200 on create but 403 on delete, owner → 200 on delete;
  last owner cannot be demoted (400).
- **Secrets at rest** — POST a source with secret fields, assert the response holds `{"present": true}` and the DB
  row holds `{"__enc": …}` (`test_create_source_encrypts_secret_fields_at_rest`).
- **LLM-dependent code** — patch where the name is *used*, with `AsyncMock`:
  ```python
  with patch("app.scripts.automl.chat_completion", new_callable=AsyncMock) as llm, \
       patch("app.scripts.automl.record_log", new_callable=AsyncMock):
      llm.return_value = ("report text", {"provider": "openai", "model": "m",
                                          "input_tokens": 1, "output_tokens": 1}, {})
  ```
  `chat_completion` returns `(content, usage, trace)`.
- **Pure helpers** — table-driven tests like `test_generated_query.py` (`_extract_generated_query` precedence,
  blank/non-string inputs), `test_pipeline_versioning.py` (`diff_versions` add/remove/change/top-level),
  `test_lineage.py` (`tracked_run` success and error paths), `test_storage.py` (path traversal rejected).
- **Static guard as a test** — `test_tenancy_lint.py` fails when a tenant-scoped `select(...)` lacks
  `tenant_filter`; extend `TENANT_SCOPED_MODELS` when you add an org-scoped model.

## Extra local checks (CI does not run them)

```bash
cd backend && ruff check --select F821 app        # undefined names; today reports 16 in etl/data_engineering/medallion routers
cd backend && python -c "import pkgutil, importlib, app.routers as r; [importlib.import_module(f'app.routers.{m.name}') for m in pkgutil.iter_modules(r.__path__)]"
```

- The F821 check would have caught every `NameError: user` from the tenancy refactor (6c53c98, b469ae0, 0769a14)
  and the three routers still broken. Note it only checks names, not types: `ask_question(request, db, user)` in the
  bots passes a `User` where a `TenantScope` is expected and still needs a test or a type checker.
- When a change touches credentials, test with the **exact payload the frontend sends** (camelCase keys such as
  `connectionString`, `apiKey`) and assert they come back masked — the existing test uses snake_case keys and passes
  while real payloads are stored in plaintext.

## What has no tests today

Onboarding, charting, elaboration and follow-ups, every `ask_*.py` connector, medallion/ETL/CDP/data-engineering
routers, bots, MCP server, public API, API-key creation, alerts and webhooks. When you change one of these, add at
least one test for the path you touched (mock `chat_completion`, `record_log` and external HTTP).

## Before committing

- Backend: `pytest -q` green, `ruff check --select F821 app` adds no new findings.
- Frontend: `npm run typecheck && npm run lint && npm test`.
- Schema changes: also follow the `db-migrations` skill checks.
