# Data Talks

An intelligent data analysis platform that lets you connect data sources, configure AI agents, and get insights through natural language questions.

## Overview

Data Talks is a web app that changes how you work with your data. Through a simple interface you can:

- **Connect data sources** (CSV, XLSX, BigQuery)
- **Configure custom AI agents**
- **Ask questions** in natural language about your data
- **Get visual answers** with charts and tables
- **Set up alerts** for ongoing monitoring

## Main features

### Data source management
- **File upload**: CSV and XLSX support
- **BigQuery**: Direct Google BigQuery integration
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

### Backend & infrastructure
- **Supabase** (optional): Backend-as-a-Service, PostgreSQL
- **Python backend** (optional): FastAPI, SQLite, LLM (OpenAI or Ollama), no Supabase/Langflow

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
│   └── services/            # API clients
├── backend/                # Optional Python backend (no Supabase/Langflow)
│   ├── app/                # FastAPI, JWT auth, CRUD, per-source-type scripts
│   └── requirements.txt
├── supabase/               # (Legacy) Supabase config and functions
└── public/                 # Static assets
```

## How to run

### Option A: Python backend (recommended — no Supabase/Langflow)

Run the app with a **Python** backend that uses **per-source-type scripts** (CSV, Google Sheets, SQL, BigQuery) and an **LLM** (OpenAI API or local Ollama). No data is sent to Supabase or Langflow.

1. **Backend**
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   cp .env.example .env    # Edit and set OPENAI_API_KEY or Ollama
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Frontend** (from project root)
   ```bash
   npm install
   ```
   Create `.env.local`:
   ```env
   VITE_API_URL=http://localhost:8000
   ```
   Then:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:8080](http://localhost:8080). Login, signup, and questions are handled by the Python backend.

### Option B: Supabase + Langflow (legacy)

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/Empreiteiro/data-talks.git
   cd data-talks
   npm install
   ```

2. Create `.env.local` (do **not** set `VITE_API_URL`):
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
   For production (e.g. email invites), set `SITE_URL` in Supabase to your app URL.

3. Run:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:8080](http://localhost:8080).

## How to use

1. **First use**: Create an account or log in; choose language (PT/EN).
2. **Data sources**: Go to Sources, upload CSV/XLSX or connect BigQuery.
3. **Agent**: Create an agent, set name, description, and data sources; add suggested questions.
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
