# CLAUDE.md — Data Talks

## Project Overview

Data Talks is a full-stack AI-powered data analysis platform. Users connect data sources (CSV, XLSX, SQL databases, BigQuery, Google Sheets, GitHub, dbt) and ask questions in natural language. The platform generates SQL/Python code, executes it, and returns answers with charts.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite 5, Tailwind CSS, shadcn/ui (Radix), React Query v5, React Router v6
- **Backend**: Python 3.11+, FastAPI 0.115+, SQLAlchemy 2.0+ (async), Alembic, Pydantic v2
- **Database**: SQLite (default) or PostgreSQL (via DATABASE_URL)
- **LLM**: OpenAI / Ollama / LiteLLM (configurable per user)
- **Auth**: JWT (python-jose + passlib/bcrypt), optional login mode

## Quick Reference Commands

```bash
# Install everything
make install

# Development (backend + frontend with hot reload)
make dev

# Build frontend and run production-like
make run

# Database migrations
make migrate

# Frontend only
npm run dev          # Dev server on :5173
npm run build        # Production build
npm run lint         # ESLint
npm test             # Vitest
npm run typecheck    # tsc --noEmit

# Backend only
cd backend && uv run data-talks run   # Starts on :8000
cd backend && uv run alembic upgrade head
cd backend && pytest
```

## Project Structure

```
├── src/                  # React frontend
│   ├── components/       # Reusable components
│   │   └── ui/           # shadcn/ui primitives (do NOT edit manually)
│   ├── pages/            # Route-level page components
│   ├── services/         # API client and service functions
│   ├── hooks/            # Custom React hooks
│   ├── contexts/         # React context providers
│   ├── lib/              # Shared utilities
│   └── utils/            # Helper functions
├── backend/
│   └── app/
│       ├── main.py       # FastAPI app entry point
│       ├── models.py     # SQLAlchemy models (all tables)
│       ├── schemas.py    # Pydantic request/response schemas
│       ├── database.py   # DB engine and session setup
│       ├── auth.py       # JWT auth utilities
│       ├── config.py     # Settings from environment
│       ├── routers/      # API route handlers
│       ├── scripts/      # Per-source-type Q&A and summary scripts
│       ├── llm/          # LLM client abstraction and utilities
│       └── services/     # Business logic (email, webhooks, alerts)
├── Makefile              # Common dev commands
├── vite.config.ts        # Vite bundler config
├── tailwind.config.ts    # Tailwind theme and plugins
└── package.json          # Frontend dependencies
```

## Key Conventions

### Language
- **All code, comments, commit messages, and docs MUST be in English.**
- UI strings for end users go through i18n (`LanguageContext`) and support PT/EN/ES.

### Frontend
- Components use PascalCase filenames (e.g., `SourcesPanel.tsx`).
- Hooks use camelCase with `use` prefix (e.g., `useAuth.ts`).
- Use `api()` from `src/services/apiClient.ts` for all backend requests.
- Use `useAuth()` for authentication state.
- Use `useLanguage()` for translated strings.
- Path alias: `@/` maps to `src/`.
- shadcn/ui components in `src/components/ui/` — do not edit directly; use `npx shadcn-ui@latest add <component>` to add new ones.
- React Query for server state; avoid manual fetch + useState patterns.

### Backend
- Endpoints that touch tenant-scoped models (Source, Agent, PipelineRun, …) use `Depends(require_membership)` to resolve a `TenantScope` (user + organization_id + role), then filter every query with `tenant_filter(Model, scope)`.
- Write/delete endpoints add `Depends(require_role("member"))` / `Depends(require_role("admin"))`.
- User-personal endpoints (LlmConfig, QA sessions, dashboards) still use `Depends(require_user)`.
- Database sessions injected via `Depends(get_db)`.
- Source-specific Q&A logic lives in `app/scripts/ask_<type>.py`.
- LLM calls go through `app/llm/client.py` (never call OpenAI SDK directly).
- All DB operations are async (use `await` with SQLAlchemy async session).
- Secrets in `Source.metadata_` and Telegram/WhatsApp/Slack bot tokens are Fernet-encrypted at rest; see `app/services/crypto.py`.
- New tables/columns require an Alembic migration.

### Database
- IDs are UUID v4 strings (not auto-increment integers).
- Guest mode uses fixed `GUEST_USER_ID`; admin uses `ADMIN_USER_ID`. The guest user is auto-enrolled as `owner` of a single `Guest` organization.
- Multi-tenancy: `Organization` + `OrganizationMembership` drive the active-tenant scope. A User may belong to N Orgs; the active one travels in the JWT `org_id` claim or is bound to the ApiKey row.
- Role hierarchy (ascending): `viewer < member < admin < owner`. `require_role("admin")` lets admins + owners through.

### Git & PRs
- Keep commits focused and descriptive.
- PR descriptions must include a summary and test plan.
- Do not push directly to `main`; use feature branches.

## Environment Variables

Backend config lives in `backend/.env`. Key variables:
- `LLM_PROVIDER`: `openai` | `ollama` | `litellm`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- `SECRET_KEY`: JWT signing key. Also seeds the Fernet key used to encrypt secrets at rest, via HKDF.
- `ENABLE_LOGIN`: `true` enables multi-user auth; `false` (default) is guest mode.
- `GITHUB_TOKEN_ENCRYPTION_KEY`: optional explicit Fernet key (url-safe base64, 32 bytes). Overrides the HKDF derivation from `SECRET_KEY`. Set this if you need the encryption key to be independent of your JWT key (e.g., rotate JWT without re-encrypting every secret).
- `DATABASE_URL`: Override default SQLite (e.g., PostgreSQL connection string)
- `SMTP_*`: Email configuration for alerts and reports

## Authentication & Multi-Tenancy

### Modes
1. **Guest mode** (`ENABLE_LOGIN=false`): No login screen; one guest user is auto-enrolled as `owner` of a single `Guest` organization. Every query still runs through the tenant scope, so the same security invariants hold even in dev.
2. **Login mode** (`ENABLE_LOGIN=true`): JWT auth. `POST /auth/login` returns `{access_token, user, organizations, active_organization_id}`. The JWT carries an `org_id` claim identifying the active tenant. Users switch orgs via `POST /auth/switch-org` which issues a new token.
3. **API key auth**: `X-API-Key` header for programmatic access. Each key is tenant-bound (`ApiKey.organization_id NOT NULL`) so it resolves to exactly one organization. MCP tool calls always require an API key — there is no guest fallback on `/mcp`.

### Roles
- `owner` — full control including future org membership management
- `admin` — can delete tenant-scoped resources
- `member` — can create/edit
- `viewer` — read-only

Role is per-`OrganizationMembership`, so the same user may be `admin` in org A and `viewer` in org B.

### Encryption at rest
- `Source.metadata_` secret fields (`password`, `api_key`, `service_account_json`, `connection_string`, `bearer_token`, …) are Fernet-wrapped as `{"__enc": "<cipher>"}` envelopes before persisting. Scripts and routers call `unlock_source_metadata(source)` or `decrypt_secret_fields()` transparently; API responses use `mask_secret_fields()` to never echo plaintext.
- Telegram/WhatsApp/Slack bot tokens + Slack client/signing secrets are wrapped via the `EncryptedText` SQLAlchemy type, so `cfg.bot_token` is always plaintext in Python but encrypted in the DB.
- GitHub OAuth access/refresh tokens are encrypted via the same Fernet key (see `app/services/github_oauth.py`).

## Testing

- Frontend: `npm test` (Vitest). Tests in `src/__tests__/`.
- Backend: `cd backend && pytest`. Tests in `backend/tests/`.
- Always run `npm run lint` and `npm run typecheck` before committing frontend changes.

## Common Pitfalls

- The frontend dev server runs on port **5173** (Vite default), backend on **8000**. Vite proxies API calls via `VITE_API_URL`. Port 8080 was the previous default but conflicts with common local services (Firestore emulator, Tomcat, Jenkins).
- SQLAlchemy models are all in a single `models.py` file — keep it that way.
- Charts are generated server-side (matplotlib) and served as images, not rendered in the frontend.
- The `dist/` folder is served by FastAPI as static files in production mode.
