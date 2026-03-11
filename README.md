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
- **File upload**: CSV and XLSX support
- **BigQuery**: Direct Google BigQuery integration
- **SQL databases**: PostgreSQL, MySQL, and other SQL-compatible databases
- **Google Sheets**: Direct spreadsheet connection
- **Automatic metadata**: Column and type detection
- **Data preview**: First rows preview

### AI agents
- **Custom setup**: Name, description, and data sources
- **Suggested questions**: Auto-suggestions from your data
- **Conversation history**: Full interaction history
- **Sharing**: Public or private agents

### Q&A
- **Conversational UI**: Ask in Portuguese or English
- **Visual answers**: Auto-generated charts and tables
- **Follow-up questions**: Suggestions to dig deeper
- **User feedback**: Answer rating

### SQL features
- **Multi-table queries**: Ask questions across multiple SQL sources; the agent infers JOINs from column names (e.g. `customer_id`, `order_id`) or uses configured relationships
- **ER diagram**: Entity-relationship view showing how tables connect through configured SQL links
- **SQL mode**: When enabled in Agent Settings, the agent responds with the raw SQL query instead of the elaborated answer—useful for debugging or learning

### Alerts
- **Ongoing monitoring**: Recurring alerts
- **Flexible schedule**: Daily, weekly, or monthly
- **Notifications**: Alerts when data changes

### Internationalization
- **Multilingual**: Portuguese and English
- **Language persistence**: Preference saved across sessions
- **Adaptive UI**: All text translated dynamically

## Tech stack

### Frontend
- **React 18**, **TypeScript**, **Vite**, **Tailwind CSS**, **shadcn/ui**

### Backend
- **Python**: FastAPI, SQLite (default) or PostgreSQL, Alembic migrations
- **LLM**: OpenAI API or local Ollama
- **Per-source scripts**: CSV, Google Sheets, SQL (single and multi-source), BigQuery

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

### Run the app at a single URL (recommended)

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
3. Open in the browser: [http://localhost:8000](http://localhost:8000). Login, signup, and Q&A use the Python backend.

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
.venv\Scripts\activate   # Windows
pip install -e .
cp .env.example .env
data-talks run
```

In `backend/.env`, if you only add `OPENAI_API_KEY`, the backend will automatically assume `gpt-4o-mini` for text and `gpt-4o-mini-tts` for audio as the environment fallback configuration.

- **`data-talks run`** — starts the API on `0.0.0.0:8000`. Use `--host` and `--port` to override.
- **`data-talks migrate`** — runs database migrations.
- API: [http://localhost:8000](http://localhost:8000) · Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend in dev mode (hot reload)

To develop the frontend with hot reload:

1. Backend running (as above).
2. From the project root: create `.env.local` with `VITE_API_URL=http://localhost:8000`, then `npm install` and `npm run dev`.
3. Open [http://localhost:8080](http://localhost:8080).

## How to use

1. **First use**: Create an account or log in; choose language (PT/EN).
2. **Data sources**: Go to Sources, upload CSV/XLSX, connect BigQuery, or add SQL databases.
3. **Agent**: Create an agent, set name, description, and data sources; add suggested questions. For multiple SQL sources, configure relationships (SQL Links) and optionally enable SQL mode.
4. **Questions**: Open a workspace, ask in natural language, get answers and charts.
5. **Alerts** (optional): Configure recurring alerts and conditions.

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production build
npm run lint     # Lint
```

## Internationalization

The app supports Portuguese and English via a central translation layer:

- **Context**: `src/contexts/LanguageContext.tsx`
- **Hook**: `useLanguage()` for translations
- **Usage**: `t('key.subkey')` in components
- **Storage**: Language preference in localStorage

## Deploy

Connect the repo [Empreiteiro/data-talks](https://github.com/Empreiteiro/data-talks) to Vercel, Netlify, or similar; set env vars; deploy on push.

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
