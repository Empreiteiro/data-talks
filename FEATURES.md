# Feature Roadmap

Suggested features for Data Talks, organized by priority.

## High priority

Features that complement existing infrastructure and have UI placeholders already in place.

- [ ] **WhatsApp Integration** — Connect agents to WhatsApp Business API for Q&A via messages. Reuse the Telegram infrastructure pattern (router, models, connection flow). UI placeholder already exists in StudioPanel.
- [ ] **Slack Integration** — Slack bot that answers questions in channels via slash commands. OAuth2 flow, event listener, per-channel agent binding. UI placeholder already exists in StudioPanel.
- [ ] **Scheduled Reports (email)** — Extend the existing Alerts system to generate and email periodic PDF/summary reports with charts. Add a "report" type to the Alert model, integrate with `summary_*.py` and charting, send via SMTP.
- [ ] **Data Export (CSV/XLSX/PDF)** — Export button on each Q&A answer to download the result table as CSV/XLSX or the full answer as PDF. New endpoint `GET /api/sessions/{id}/export?format=csv|xlsx|pdf`.

## Medium priority

Features that expand platform capabilities into new areas.

- [ ] **RAG / Document Sources** — New source type "document" for PDFs, Word files, and wikis. Embedding + vector search (ChromaDB or pgvector) before LLM call. New script `ask_documents.py`, chunking pipeline, semantic retrieval.
- [ ] **External API Keys** — Allow programmatic access to agents via API keys with rate limiting. Model `ApiKey`, API-key auth middleware, public endpoint `/api/v1/ask`.
- [ ] **Collaborative Workspaces** — Share agents and sessions across an organization. Expand the existing `organization_id` field in models, add per-agent roles (viewer/editor/admin), shared conversation history.
- [ ] **Automatic Data Source Sync** — Scheduled refresh of metadata and data for all source types. Schema change detection and notifications. Scheduler (APScheduler or Celery), sync endpoint, configuration UI.

## Low priority

Differentiating features for advanced use cases.

- [ ] **Auto ML** — Simplified ML pipeline: select a target column, run a basic model (scikit-learn), display results with explanations. New router `automl_router.py`, training scripts, wizard UI. Placeholder already exists in StudioPanel.
- [ ] **Custom Chart Editor** — Let users customize auto-generated charts (chart type, colors, labels, filters) with a live preview. New `ChartEditor.tsx` component, save chart config per chart, re-render on backend.
- [ ] **Full Audit Trail** — Extend the existing `PlatformLog` into a complete audit system logging all user actions (queries, source access, config changes). Audit middleware, filter/search UI, log export.
- [ ] **Outgoing Webhooks** — Configure webhooks that fire when alert conditions are met, enabling integration with any external system. Model `Webhook`, async dispatcher, configuration UI.
