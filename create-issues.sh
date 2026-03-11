#!/usr/bin/env bash
# Run this script from the project root after authenticating: gh auth login
# Usage: bash create-issues.sh

set -e

REPO="Empreiteiro/data-talks"

# Create labels (idempotent — ignores if they already exist)
gh label create "enhancement"     --description "New feature or request"    --color "a2eeef" --repo "$REPO" 2>/dev/null || true
gh label create "high priority"   --description "High priority feature"    --color "d93f0b" --repo "$REPO" 2>/dev/null || true
gh label create "medium priority" --description "Medium priority feature"  --color "fbca04" --repo "$REPO" 2>/dev/null || true
gh label create "low priority"    --description "Low priority feature"     --color "0e8a16" --repo "$REPO" 2>/dev/null || true

echo "=== Creating high priority issues ==="

gh issue create --repo "$REPO" --title "WhatsApp Integration" --label "enhancement,high priority" --body "## Description

Connect agents to WhatsApp Business API for Q&A via messages.

## Details

- Reuse the Telegram infrastructure pattern (router, models, connection flow)
- UI placeholder already exists in \`StudioPanel.tsx\`
- New router \`whatsapp_router.py\`
- New models: \`WhatsAppConfig\`, \`WhatsAppConnection\`
- New component: \`WhatsAppModal.tsx\`

## Priority

High — complements existing infrastructure and has UI placeholder already in place."

gh issue create --repo "$REPO" --title "Slack Integration" --label "enhancement,high priority" --body "## Description

Slack bot that answers questions in channels via slash commands.

## Details

- OAuth2 flow for Slack workspace connection
- Event listener for slash commands and mentions
- Per-channel agent binding
- UI placeholder already exists in \`StudioPanel.tsx\`
- New router \`slack_router.py\`

## Priority

High — complements existing infrastructure and has UI placeholder already in place."

gh issue create --repo "$REPO" --title "Scheduled Reports (email)" --label "enhancement,high priority" --body "## Description

Extend the existing Alerts system to generate and email periodic PDF/summary reports with charts.

## Details

- Add a \"report\" type to the \`Alert\` model
- Integrate with existing \`summary_*.py\` scripts and charting engine
- Send reports via SMTP
- Configurable schedule (daily, weekly, monthly)
- Include charts and executive summaries in the email body or as PDF attachment

## Priority

High — builds directly on top of the existing Alerts and Studio Summary infrastructure."

gh issue create --repo "$REPO" --title "Data Export (CSV/XLSX/PDF)" --label "enhancement,high priority" --body "## Description

Export button on each Q&A answer to download the result table as CSV/XLSX or the full answer as PDF.

## Details

- New endpoint \`GET /api/sessions/{id}/export?format=csv|xlsx|pdf\`
- CSV/XLSX export of the result table data
- PDF export of the full answer (text + chart + table)
- Download button in the Workspace UI next to each answer

## Priority

High — straightforward to implement with existing data and commonly requested by users."

echo "=== Creating medium priority issues ==="

gh issue create --repo "$REPO" --title "RAG / Document Sources" --label "enhancement,medium priority" --body "## Description

New source type \"document\" for PDFs, Word files, and wikis with embedding and vector search.

## Details

- Embedding + vector search (ChromaDB or pgvector) before LLM call
- New script \`ask_documents.py\`
- Upload PDFs and Word files as data sources
- Chunking pipeline and semantic retrieval
- New source type in the frontend source selector

## Priority

Medium — expands platform capabilities into unstructured data."

gh issue create --repo "$REPO" --title "External API Keys" --label "enhancement,medium priority" --body "## Description

Allow programmatic access to agents via API keys with rate limiting.

## Details

- New model \`ApiKey\` (key, agent_id, user_id, rate_limit, created_at, expires_at)
- API-key auth middleware (check \`X-API-Key\` header)
- Public endpoint \`POST /api/v1/ask\` for external integrations
- Key management UI in Account settings
- Rate limiting per key

## Priority

Medium — enables third-party integrations and automation."

gh issue create --repo "$REPO" --title "Collaborative Workspaces" --label "enhancement,medium priority" --body "## Description

Share agents and sessions across an organization with role-based access.

## Details

- Expand the existing \`organization_id\` field in models
- Add per-agent roles: viewer, editor, admin
- Shared conversation history visible to team members
- Organization management UI
- Invite flow for adding team members

## Priority

Medium — enables team collaboration on data analysis."

gh issue create --repo "$REPO" --title "Automatic Data Source Sync" --label "enhancement,medium priority" --body "## Description

Scheduled refresh of metadata and data for all source types with schema change detection.

## Details

- Scheduler (APScheduler or Celery) for periodic refresh
- Sync endpoint per source type
- Schema change detection and user notifications
- Configuration UI for sync frequency per source
- Support for CSV re-upload, SQL schema refresh, BigQuery metadata refresh

## Priority

Medium — keeps data sources up to date without manual intervention."

echo "=== Creating low priority issues ==="

gh issue create --repo "$REPO" --title "Auto ML" --label "enhancement,low priority" --body "## Description

Simplified ML pipeline: select a target column, run a basic model, display results with explanations.

## Details

- New router \`automl_router.py\`
- Training scripts using scikit-learn (classification, regression, clustering)
- Wizard UI for column selection and model configuration
- Results display with feature importance and metrics
- Placeholder already exists in \`StudioPanel.tsx\`

## Priority

Low — differentiating feature for advanced use cases."

gh issue create --repo "$REPO" --title "Custom Chart Editor" --label "enhancement,low priority" --body "## Description

Let users customize auto-generated charts with a live preview.

## Details

- New \`ChartEditor.tsx\` component
- Options: chart type, colors, labels, filters, axis configuration
- Save chart config per chart in the database
- Re-render on backend with updated config
- Live preview in the editor

## Priority

Low — enhances the existing charting experience."

gh issue create --repo "$REPO" --title "Full Audit Trail" --label "enhancement,low priority" --body "## Description

Extend the existing \`PlatformLog\` into a complete audit system logging all user actions.

## Details

- Audit middleware logging: queries, source access, config changes, user management actions
- Filter and search UI for audit logs
- Export audit logs as CSV
- Retention policy configuration
- Extends the existing \`platform_logs\` table

## Priority

Low — important for enterprise compliance requirements."

gh issue create --repo "$REPO" --title "Outgoing Webhooks" --label "enhancement,low priority" --body "## Description

Configure webhooks that fire when alert conditions are met, enabling integration with any external system.

## Details

- New model \`Webhook\` (url, secret, events, agent_id, created_at)
- Async dispatcher with retry logic
- HMAC signature for webhook verification
- Configuration UI in Alert settings
- Support for custom headers and payload templates

## Priority

Low — enables integration with arbitrary external systems."

echo ""
echo "=== All 12 issues created successfully ==="
