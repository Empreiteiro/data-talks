# Data Talks

An intelligent data analysis platform that lets you connect data sources, configure AI agents, and get insights through natural language questions.

## Overview

Data Talks is a web app that changes how you work with your data. Through a simple interface you can:

- **Connect data sources** (CSV, XLSX, BigQuery, SQL databases)
- **Configure custom AI agents**
- **Ask questions** in natural language about your data
- **Get visual answers** with charts and tables
- **Set up alerts** for ongoing monitoring

## Main features

### Data source management
- **File upload**: CSV, XLSX, JSON/JSONL, Parquet, SQLite databases
- **BigQuery**: Direct Google BigQuery integration
- **SQL databases**: PostgreSQL, MySQL, MongoDB, Snowflake, and other SQL-compatible databases
- **Google Sheets** & **Microsoft Excel Online**: Direct spreadsheet connections
- **Cloud storage**: Amazon S3 / MinIO buckets
- **REST APIs**: Generic connector for any JSON-returning API
- **SaaS integrations**: Stripe, Salesforce, HubSpot, Pipedrive, Shopify, Intercom, Notion, Jira, GA4, GitHub Analytics, AWS Cost — each with pre-built table catalogs and report templates
- **Automatic metadata**: Column and type detection, sample profile, top-values stats
- **Data preview**: First rows preview

### Source onboarding wizard
After connecting a source (or selecting several together), an LLM-driven flow captures the domain knowledge that makes future Q&A reliable:

- **Clarifying questions**: LLM-generated questions about ambiguous columns ("What does `mrr_usd` mean here?", "Which timezone are timestamps in?")
- **Warm-up questions**: 4–8 starter questions tailored to the source
- **KPI candidates**: Suggested KPIs (name + definition + dependencies); confirmed ones surface as workspace chips and feed into Q&A context
- **Filter suggestions**: Date columns and low-cardinality categorical columns become workspace-level filters available next to the logs button
- **Source-scoped instructions**: A second prompt textarea that only applies when this source is in the active workspace, layered on top of the agent-level prompt

The wizard runs against a **SourceGroup** when more than one source is added or selected together, so the LLM reasons about cross-source relationships (join keys, conflicting column meanings) and pins the resulting assets to the SET of sources rather than to either one alone.

### Workspace types
- **Data Analysis** (GA): Q&A over connected sources
- **Customer Data Platform** (Beta): Identity resolution and segment authoring across multiple sources
- **ETL Pipeline** (Beta): Pipeline authoring with versioning and GitHub-backed history

### AI agents (workspaces)
- **Custom setup**: Name, description (specific instructions for the agent), data sources, LLM config
- **Suggested questions**: Manually-typed (workspace-wide) and onboarding-generated (per-source) — merged in the chat empty state
- **Conversation history**: Full interaction history with feedback ratings
- **LLM fallback**: A workspace without a selected LLM transparently falls back to your default LlmConfig

### Q&A
- **Conversational UI**: Ask in Portuguese, English, or Spanish
- **Visual answers**: Auto-generated charts and tables, server-rendered as images
- **Inline references**: Click chips in the empty state to insert column names or KPIs into your question; pick filter values from a popover next to the logs button to constrain every follow-up
- **Follow-up questions**: Suggestions to dig deeper
- **User feedback**: Answer rating

### SQL features
- **Multi-table queries**: Ask questions across multiple SQL sources; the agent infers JOINs from column names (e.g. `customer_id`, `order_id`) or uses configured relationships
- **ER diagram**: Entity-relationship view showing how tables connect through configured SQL links
- **SQL mode**: When enabled in Agent Settings, the agent responds with the raw SQL query instead of the elaborated answer — useful for debugging or learning

### Alerts
- **Ongoing monitoring**: Recurring alerts on natural-language questions
- **Flexible schedule**: Daily, weekly, or monthly
- **Notifications**: Alerts when data changes

### Studio
- **Table summaries**: Auto-generated executive reports for any data source (CSV, SQL, BigQuery, Google Sheets, Firebase, …)
- **Audio overviews**: Text-to-speech narration of source highlights using the configured audio model
- **Report templates**: Fixed-schema reports for SaaS integrations (CRM funnels, e-commerce KPIs, support metrics, etc)

### Dashboards
- **Saved charts**: Pin Q&A charts to a dashboard for quick reference
- **Custom layout**: Position and resize charts freely
- **Multiple dashboards**: Organize charts by topic or team

### Multi-tenancy & access control
- **Organizations**: Users belong to one or more organizations; each org owns its own sources, agents, dashboards, and KPIs
- **Memberships with roles**: `viewer < member < admin < owner` — roles enforced per-endpoint (read endpoints check membership, writes check role)
- **Switch organizations**: Active org travels in the JWT or is bound to an API key; switch with a single click
- **Encrypted secrets at rest**: Source credentials, bot tokens, GitHub OAuth tokens, and Claude OAuth tokens are Fernet-encrypted in the database

### MCP server
- **External AI integration**: Expose Data Talks as a Model Context Protocol (MCP) server so external tools (Claude Desktop, IDEs, etc.) can list workspaces, run questions, and read summaries via API key auth

### Telegram, WhatsApp & Slack integrations
- **Bot configuration**: Register one or more bots per channel
- **Agent linking**: Connect a workspace to a chat group via link token
- **Q&A over chat**: Ask questions and receive answers directly in the channel

### GitHub-backed pipeline versioning
- **Pipeline snapshots**: Each pipeline edit creates an immutable version row
- **GitHub OAuth integration**: Versions can be pushed to a configured repo/branch as commits, giving full diff history
- **Restore**: Roll back any prior version

### Platform logs & audit
- **LLM activity tracking**: Every question and summary is logged with provider, model, and token usage
- **Channel attribution**: See whether activity came from the workspace, Telegram, or Studio
- **Audit middleware**: Tenant-scoped action log

### Internationalization
- **Multilingual**: Portuguese, English, and Spanish
- **Language persistence**: Preference saved across sessions
- **Adaptive UI**: All text translated dynamically

## Tech stack

### Frontend
- **React 18**, **TypeScript**, **Vite 5**, **Tailwind CSS**, **shadcn/ui** (Radix), **React Query v5**
- Dev server: **port 5173** (Vite default; `strictPort: true`, no silent fallback)

### Backend
- **Python 3.11+**: FastAPI, SQLAlchemy 2.0 (async), Alembic migrations
- **DB**: SQLite (default) or PostgreSQL via `DATABASE_URL`
- **LLM providers**: OpenAI / OpenAI-compatible (LiteLLM, OpenRouter, …), Ollama, Anthropic Claude (API), Claude Code (OAuth/CLI), Google Gemini
- **Per-source scripts**: CSV, Google Sheets, SQL (single and multi-source), BigQuery, Firebase, GitHub, dbt, MongoDB, Snowflake, S3, REST APIs, and 10+ SaaS integrations
- API server: **port 8000**

### Ports

| Service | Port | Notes |
|---|---|---|
| Frontend (Vite dev) | **5173** | `strictPort` — fails loudly on collision |
| Backend (FastAPI) | **8000** | CLI auto-falls back to 8001–8005 if 8000 is taken; the resolved port is written to `backend/.backend_port` and Vite proxies `/api` accordingly |

`make dev` runs `scripts/free-dev-ports.sh` first, which kills only **our own** zombies on ports `5173` and `8000–8005` (matches narrowly on `data-talks run`, `uvicorn app.main`, and the Vite binary) so a Firestore emulator or other tool you happen to have running on the same port is left alone.

### LLM environment defaults

When you configure `OPENAI_API_KEY` in `backend/.env`, the backend uses these environment defaults unless you explicitly override them:

- **Text model**: `gpt-4o-mini`
- **Audio model**: `gpt-4o-mini-tts`

If you want different defaults, set `OPENAI_MODEL` and/or `OPENAI_AUDIO_MODEL` explicitly in `backend/.env`.

### State
- **React Context API**, **React Query**, **Local Storage**

## Project structure

```
data-talks/
├── src/                    # Frontend
│   ├── components/         # Reusable components
│   ├── contexts/           # React contexts (e.g. LanguageContext)
│   ├── hooks/              # Custom hooks
│   ├── lib/                # Utilities
│   ├── pages/              # Pages
│   └── services/           # API clients
├── backend/                # Python API (FastAPI, JWT auth, CRUD, scripts)
│   ├── app/                # FastAPI app, routers, per-source-type scripts
│   ├── alembic/            # Database migrations (SQLite + PostgreSQL)
│   └── pyproject.toml
└── public/                 # Static assets
```

## How to run

### Quick start with Make (recommended)

```bash
make install        # Install frontend and backend dependencies
make run            # Build frontend and start the server at http://localhost:8000
```

Other useful commands:

```bash
make install-cli    # Install only the data-talks CLI
make build          # Build frontend for production
make dev            # Start backend + frontend dev server with hot reload
make migrate        # Run database migrations
make setup-env      # Create backend/.env from .env.example
make lint           # Run frontend linter
make test           # Run frontend tests
make help           # List all available commands
```

> **Requires**: Node.js, [uv](https://docs.astral.sh/uv/), and Python 3.11+.

---

### Run the app at a single URL (manual)

To open the UI at **http://localhost:8000** (backend only):

1. **Project root** — install the frontend and build with the API URL:
   ```bash
   npm install
   npm run build
   ```
2. **Backend** — configure and start the API (it will serve the frontend at `/`):
   ```bash
   cd backend
   uv pip install -e .
   uv run data-talks run
   ```
3. Open in the browser: [http://localhost:8000](http://localhost:8000). By default the app runs without login; enable `ENABLE_LOGIN=true` in `backend/.env` to require authentication.

If the `dist/` folder does not exist, visiting http://localhost:8000 will show a JSON message with instructions; run `npm run build` from the project root and restart the backend.

### Backend only (API)

From the **backend** directory:

**With [uv](https://docs.astral.sh/uv/):**
```bash
cd backend
uv pip install -e .
cp .env.example .env
uv run data-talks run
```

**With pip + venv:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows
pip install -e .
cp .env.example .env
data-talks run
```

In `backend/.env`, if you only add `OPENAI_API_KEY`, the backend will automatically assume `gpt-4o-mini` for text and `gpt-4o-mini-tts` for audio as the environment fallback configuration.

- **`data-talks run`** — starts the API on `0.0.0.0:8000`. Use `--host` and `--port` to override.
- **`data-talks migrate`** — runs database migrations.
- API: [http://localhost:8000](http://localhost:8000) · Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend in dev mode (hot reload)

The fastest path is `make dev` from the project root — it frees stale ports, starts the backend, waits for it to write `backend/.backend_port`, then launches Vite. Vite's `/api` proxy reads that file on every request, so you never have to set `VITE_API_URL` manually even if the backend lands on `:8001` instead of `:8000`.

To run them manually instead:

1. Backend running (as above) on `:8000`.
2. From the project root: `npm install` and `npm run dev`.
3. Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to whatever port the backend is on.

Override the proxy target only if you're talking to a remote backend: create `.env.local` with `VITE_API_URL=https://your-backend-host`. Otherwise leave it unset.

## How to use

By default, the app runs in guest mode: no login required. Choose your language (PT/EN/ES) and start.

1. **Workspace**: From the home page, select or create a workspace. Pick a workspace type — Data Analysis (GA), CDP (Beta), or ETL (Beta).
2. **Data sources**: In the Sources panel, upload CSV/XLSX/JSON/Parquet/SQLite, connect BigQuery/Google Sheets/Excel Online, add SQL/MongoDB/Snowflake databases, point at S3/REST APIs, or pick a SaaS integration (Stripe, Salesforce, HubSpot, …).
3. **Source onboarding**: Right after a source is added — or after selecting "All active sources" in Source Settings — the wizard walks through clarifications, warm-ups, filter suggestions, KPIs, and a per-source instructions field. Skip any time; re-run later via the refresh icon next to "Available Columns".
4. **Agent setup**: Configure name, specific instructions, LLM config (or leave blank to use your default LlmConfig), data sources, manually-typed warm-ups. For multiple SQL sources, configure relationships (SQL Links) and optionally enable SQL mode.
5. **Ask questions**: In the Chat panel, ask in natural language. Click the column chips, KPI chips, or apply a filter from the popover next to the logs button to constrain the question.
6. **Optional**: Set up alerts, dashboards, Telegram/WhatsApp/Slack connections, Studio summaries, audio overviews, or expose the workspace via the MCP server for external tools.

When `ENABLE_LOGIN=true` in the backend, authentication is required before using the app and a JWT token is issued per organization.

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production build
npm run lint     # Lint
```

## Internationalization

The app supports Portuguese, English, and Spanish via a central translation layer:

- **Context**: `src/contexts/LanguageContext.tsx`
- **Hook**: `useLanguage()` for translations
- **Usage**: `t('key.subkey')` in components
- **Storage**: Language preference in localStorage

## Authentication

- **Guest mode** (default): When `ENABLE_LOGIN=false`, the app opens directly with no login screen
- **Login mode**: Set `ENABLE_LOGIN=true` to require email/password authentication
- **Admin role**: Admin users can manage other users and platform settings
- **JWT tokens**: Stateless authentication via Bearer tokens

## LLM providers

The backend supports five providers. Configure one (or more) per `LlmConfig` in **Account → LLM** (or set fallback env vars in `backend/.env`):

| Provider | Key env vars / config fields | Use case |
|----------|-------------|----------|
| **OpenAI-compatible** | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | OpenAI itself, OpenRouter, DeepSeek, Together, Groq, Azure OpenAI, custom proxies. The model field is a combobox (curated suggestions + free text + on-demand catalog fetch). |
| **Ollama** | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local/self-hosted models |
| **LiteLLM** | `LITELLM_BASE_URL`, `LITELLM_MODEL`, `LITELLM_API_KEY` | Proxy to 100+ providers |
| **Anthropic Claude** (API) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Direct Anthropic API |
| **Google Gemini** | `GOOGLE_API_KEY`, `GOOGLE_MODEL` | Google's Gemini models |
| **Claude Code** | OAuth (PKCE) login button OR `CLAUDE_CODE_OAUTH_TOKEN` env | Use a Claude Pro/Max subscription via the official `claude` CLI locally, or an OAuth token in cloud deploys (Railway etc) without the CLI binary |

Users can create multiple LLM configurations per account and assign different ones to different workspaces. Workspaces with no explicit config selected fall back to the user's `is_default=true` config; that fallback in turn falls back to env-level credentials.

## Deploy

**Frontend**: Connect the repo to Vercel, Netlify, or similar; set env vars; deploy on push.

**Backend**: Run the FastAPI server behind a reverse proxy (nginx, Caddy) or deploy as a Docker container. Set `DATABASE_URL` for PostgreSQL in production.

## Contributing

1. Fork the project.
2. Create a feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit changes (`git commit -m 'Add AmazingFeature'`).
4. Push the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project standard (e.g. **documentation and comments in English**).

## License

This project is under the Apache 2.0 license. See [LICENSE](LICENSE) for details.

## Support

- **Repository**: [github.com/Empreiteiro/data-talks](https://github.com/Empreiteiro/data-talks)
- **Issues**: GitHub Issues
- **Docs**: In-code comments and this README

---

**Data Talks** — Turn data into insights with conversational AI.
