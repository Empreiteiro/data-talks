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
npm run dev          # Dev server on :8080
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
- Routers use `Depends(require_user)` for auth-protected endpoints.
- Database sessions injected via `Depends(get_db)`.
- Source-specific Q&A logic lives in `app/scripts/ask_<type>.py`.
- LLM calls go through `app/llm/client.py` (never call OpenAI SDK directly).
- All DB operations are async (use `await` with SQLAlchemy async session).
- New tables/columns require an Alembic migration.

### Database
- IDs are UUID v4 strings (not auto-increment integers).
- Guest mode uses fixed `GUEST_USER_ID`; admin uses `ADMIN_USER_ID`.
- Multi-tenancy via `organization_id` field on most models.

### Git & PRs
- Keep commits focused and descriptive.
- PR descriptions must include a summary and test plan.
- Do not push directly to `main`; use feature branches.

## Environment Variables

Backend config lives in `backend/.env`. Key variables:
- `LLM_PROVIDER`: `openai` | `ollama` | `litellm`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- `SECRET_KEY`: JWT signing key
- `ENABLE_LOGIN`: `true` enables multi-user auth; `false` (default) is guest mode
- `DATABASE_URL`: Override default SQLite (e.g., PostgreSQL connection string)
- `SMTP_*`: Email configuration for alerts and reports

## Authentication Modes

1. **Guest mode** (`ENABLE_LOGIN=false`): No login screen, single shared user.
2. **Login mode** (`ENABLE_LOGIN=true`): JWT auth, admin + regular user roles, user isolation via organization_id.
3. **API key auth**: `X-API-Key` header for the public `POST /api/v1/ask` endpoint.

## Testing

- Frontend: `npm test` (Vitest). Tests in `src/__tests__/`.
- Backend: `cd backend && pytest`. Tests in `backend/tests/`.
- Always run `npm run lint` and `npm run typecheck` before committing frontend changes.

## Common Pitfalls

- The frontend dev server runs on port **8080**, backend on **8000**. Vite proxies API calls via `VITE_API_URL`.
- SQLAlchemy models are all in a single `models.py` file — keep it that way.
- Charts are generated server-side (matplotlib) and served as images, not rendered in the frontend.
- The `dist/` folder is served by FastAPI as static files in production mode.
