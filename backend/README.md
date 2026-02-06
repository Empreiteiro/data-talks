# Data Talks (backend)

- **FastAPI** + **SQLite (default)** or **PostgreSQL** (auth, sources, agents, sessions, dashboards, alerts)
- **Alembic** migrations (same schema for SQLite and PostgreSQL)
- **Python scripts** per source type (CSV, Google Sheets, SQL, BigQuery)
- **LLM**: API (OpenAI) or local open-source model (Ollama)

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

## Install and run with uv

From the **backend** directory:

```bash
cd backend
uv pip install -e .
uv run data-talks run
```

From the **project root** (install the backend as a package):

```bash
uv pip install -e ./backend
uv run data-talks run
```

- **`data-talks run`** — starts the API server (host `0.0.0.0`, port `8000`). Use `--host` and `--port` to override.
- **`data-talks migrate`** — runs Alembic migrations (`alembic upgrade head`).

## Setup without uv (pip + venv)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # Linux/macOS
pip install -e .
# Run: data-talks run   or   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Environment variables

Create `backend/.env`:

```env
# Required for LLM (choose one)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# LLM_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2

# Auth (change in production)
SECRET_KEY=your-strong-secret-key

# Optional login: if ENABLE_LOGIN=true, show login screen and require admin credentials.
# If false (default), app opens directly with no login.
# ENABLE_LOGIN=true
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=your-password

# Database: default is SQLite (no .env needed). For PostgreSQL set:
# DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
# Optional
# DATA_FILES_DIR=./data_files
# DEBUG=false
```

## Database and migrations

- **Default**: SQLite, file `./data_talks.db`. Tables are created on first run (or run migrations).
- **PostgreSQL**: Set `DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname` in `.env`. Then run migrations from the `backend` directory:
  ```bash
  alembic upgrade head
  ```
- Migrations live in `alembic/versions/` and work for both SQLite and PostgreSQL. To create a new migration after changing models: `alembic revision --autogenerate -m "description"`.

## Run

```bash
uv run data-talks run
# Or: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API: http://localhost:8000  
- Docs: http://localhost:8000/docs  
- Health: http://localhost:8000/health  

## Main endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register (email, password) |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user (Header: `Authorization: Bearer <token>`) |
| POST | `/api/ask-question` | Ask question (body: `question`, `agentId`, `sessionId?`) → answer + follow-ups |

The frontend should point to this API (`VITE_API_URL=http://localhost:8000`) and send the JWT in the header for authenticated requests.

## Scripts per source type

- **CSV/XLSX**: `app/scripts/ask_csv.py` — reads file under `DATA_FILES_DIR`, sends schema + sample to LLM.
- **Google Sheets**: `app/scripts/ask_google_sheets.py` — uses `GOOGLE_SHEETS_SERVICE_ACCOUNT` (JSON).
- **SQL**: `app/scripts/ask_sql.py` — uses connection string and `table_infos` in source metadata.
- **BigQuery**: `app/scripts/ask_bigquery.py` — uses credentials and `table_infos`.

Each script returns `{ "answer", "imageUrl?", "followUpQuestions" }`. Charts (imageUrl) can be added later (e.g. matplotlib/plotly → base64).

## Database

SQLite with tables: `users`, `sources`, `agents`, `qa_sessions`, `dashboards`, `dashboard_charts`, `alerts`. Tables are created on startup.

## Next steps

- Full CRUD for sources, agents, dashboards, alerts over REST.
- File upload to `DATA_FILES_DIR` and registration in `sources`.
- Real Google Sheets/BigQuery integration (libraries referenced in `requirements.txt`).
