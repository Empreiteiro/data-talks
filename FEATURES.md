# Feature Roadmap

Status of Data Talks features: implemented and planned.

---

## Implemented

Features already available in the codebase.

### Integrations & channels

- [x] **Telegram** — Configurable bot, agent linking via link token, Q&A directly in chat. (`telegram_router`, models `TelegramBotConfig`, `TelegramConnection`.)
- [x] **WhatsApp** — WhatsApp Business API integration for Q&A via messages. Reuses the Telegram pattern (router, models, connection flow). (`whatsapp_router`, `WhatsAppBotConfig`, `WhatsAppConnection`.)

### API & programmatic access

- [x] **External API Keys** — Programmatic access to agents via API keys. Model `ApiKey`, auth via `X-API-Key` header, public endpoint `POST /api/v1/ask`, key management UI in Account. (Rate limiting per key can be a future enhancement.)

### Reports & alerts

- [x] **Scheduled Reports (email)** — Alerts of type `report` generate and send reports by email. Integration with Alerts system, `build_report_email` and SMTP in `alert_scheduler`. Type `alert | report` on model `Alert`.
- [x] **Studio Report** — HTML reports with exploratory charts per source. Generation and listing in `report_router`, model `Report`, scripts `report_csv`, `report_bigquery`, `report_sql`, `report_google_sheets`.
- [x] **Outgoing Webhooks** — Webhooks fired when alert conditions are met. Model `Webhook`, dispatcher with retry, HMAC signature, UI in Alert settings.

### Audit & compliance

- [x] **Full Audit Trail** — User action tracking for compliance. Model `AuditLog`, audit middleware, `audit_router` with list, filter and CSV export, retention policy (`AuditRetentionConfig`).

### Studio & analysis

- [x] **Auto ML** — Simplified ML pipeline: target column, basic model (scikit-learn), results with metrics and feature importance. Router `automl_router`, model `AutoMLRun`.

---

## Roadmap — Platform features

Suggested features organized by priority.

### High priority

- [ ] **Slack Integration** — Slack bot to answer in channels via slash commands. OAuth2, event listener, per-channel agent binding. UI placeholder already exists in StudioPanel.
- [ ] **Data Export (CSV/XLSX/PDF)** — Export button on each Q&A answer to download the result table as CSV/XLSX or the full answer as PDF. Endpoint `GET /api/sessions/{id}/export?format=csv|xlsx|pdf`.

### Medium priority

- [ ] **RAG / Document Sources** — New source type "document" (PDF, Word, wikis) with embedding and vector search (ChromaDB or pgvector). Script `ask_documents.py`, chunking pipeline and semantic retrieval.
- [ ] **Collaborative Workspaces** — Share agents and sessions across an organization with roles (viewer, editor, admin). Expand `organization_id` usage, shared history, management UI and invites.
- [ ] **Automatic Data Source Sync** — Scheduled refresh of metadata and data per source type, with schema change detection. Scheduler (APScheduler or Celery), sync endpoint, frequency UI.

### Low priority

- [ ] **Custom Chart Editor** — Customize auto-generated charts (type, colors, labels, filters) with live preview. Component `ChartEditor.tsx`, save config per chart, re-render on backend.
- [ ] **Rate limiting (API Keys)** — Usage limits per API key (optional on top of existing API keys feature).
- [ ] **Public share links** — Share a read-only view of an agent or dashboard via a public URL with optional expiry.
- [ ] **Mobile-responsive UI** — Optimize layouts and touch targets for tablets and phones.
- [ ] **Saved question templates** — Let users save and reuse common questions per agent or source.

---

## Roadmap — New data sources

Proposed data source integrations (aligned with `create-datasource-issues.sh`). Implementation pattern: new script `ask_*.py`, router `*_router.py`, frontend form component, and wiring in `crud.py` / `ask.py`.

### Databases & warehouses

- [ ] **MongoDB** — Connect MongoDB collections for natural-language analysis. NoSQL, semi-structured JSON. Script `ask_mongodb.py`, router `mongodb_router.py`, driver pymongo/motor. Metadata: connection string, database, collection, schema, preview.
- [ ] **Snowflake** — Cloud data warehouse integration. Script `ask_snowflake.py`, router `snowflake_router.py`, driver snowflake-connector-python. Metadata: account, user, warehouse, database, schema, tables. Complements BigQuery.
- [ ] **SQLite (file upload)** — Upload `.db` / `.sqlite` / `.sqlite3` files as a source; full SQL support. Reuse `ask_sql.py` logic with aiosqlite; extend `UploadSourceForm` to accept these extensions.

### Object storage & files

- [ ] **Amazon S3 / MinIO** — CSV, JSON and Parquet from S3-compatible buckets. Script `ask_s3.py`, router `s3_router.py`, boto3 + pyarrow. Metadata: credentials, bucket, key, file type, schema, preview. Supports data lake workflows.
- [ ] **Parquet / JSON file upload** — Extend file upload to accept `.parquet`, `.json`, `.jsonl`. Reuse `ask_csv.py` with pandas (read_parquet, read_json, json_normalize). Add pyarrow dependency. No new tab; extend `UploadSourceForm`.

### APIs & SaaS

- [ ] **REST API (generic connector)** — Connect any REST API that returns JSON; analyze via natural language. Script `ask_rest_api.py`, router `rest_api_router.py`. Config: URL, method, headers, query params, body, dataPath, pagination. SSRF protection and secure header storage required.
- [ ] **Notion Database** — Connect Notion databases via Notion API. Script `ask_notion.py`, router `notion_router.py`. Metadata: integration token, database id, properties, schema, preview. Targets product/marketing/ops teams.
- [ ] **Microsoft Excel Online (OneDrive/SharePoint)** — Connect Excel files from OneDrive/SharePoint via Microsoft Graph. Script `ask_excel_online.py`, router `excel_online_router.py`, OAuth2 with Azure AD. Complements Google Sheets for Microsoft 365 users.

---

## Summary

| Category            | Implemented | Roadmap (platform) | Roadmap (data sources) |
|---------------------|-------------|--------------------|-------------------------|
| Integrations         | Telegram, WhatsApp | Slack | — |
| API / access         | API Keys, public /v1/ask | Rate limiting, share links | — |
| Reports & alerts     | Scheduled reports, Studio Report, Webhooks | — | — |
| Audit                | Full audit trail | — | — |
| Analysis             | Auto ML | Chart editor, question templates | — |
| UX                   | — | Data export, mobile UI | — |
| Collaboration        | — | Collaborative workspaces, sync | — |
| Data sources         | CSV, XLSX, BigQuery, SQL, Google Sheets, GitHub, dbt | RAG/documents | MongoDB, Snowflake, S3, REST API, SQLite, Notion, Excel Online, Parquet/JSON |
