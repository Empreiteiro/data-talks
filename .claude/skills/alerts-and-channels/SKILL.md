---
name: alerts-and-channels
description: How Data Talks delivers answers outside the web UI — scheduled alerts and reports, email, outgoing webhooks, Telegram/WhatsApp/Slack bots, the MCP server and the public /v1/ask API — with the verified bugs (every bot call fails, unsigned WhatsApp webhook, fail-open Slack check, unscoped loads). Use when touching alert_scheduler.py, email_service.py, webhook_*, *_bot.py, telegram/whatsapp/slack routers, mcp_server.py or public_api_router.py.
---

# Alerts and delivery channels

Every channel should end in the same place as the web UI: a `TenantScope` + `dispatch_question` in
`routers/ask.py`, with `channel=` set (`telegram`, `whatsapp`, `slack`, `mcp`, `api`, `alert`) so `record_log`
attributes usage. Most of the bugs below come from channels that re-implemented part of that path.

## Alerts and scheduled reports

- Models: `Alert(type alert|report, question, email, frequency, execution_time "HH:MM", day_of_week,
  day_of_month, is_active, next_run, last_run, last_status)` and `AlertExecution(status, answer[:10000],
  error_message, email_sent, webhooks_fired, duration_ms)`. CRUD + "test now" live in `routers/crud.py`.
- `services/alert_scheduler.py`: `alert_scheduler_worker()` is started from the `lifespan` in `main.py` and wakes
  every `CHECK_INTERVAL_SECONDS = 60`; it selects active alerts with `next_run <= now` across **all tenants** and
  runs them one after another.
- `_compute_next_run` uses naive UTC: daily → next HH:MM; weekly → `day_of_week` (Python `weekday()`, Monday = 0);
  monthly → `min(day_of_month, 28)`; anything else → now + 1 day.
- `_execute_single_alert` has **its own** dispatch for `csv/xlsx`, `google_sheets`, `sql_database`, `bigquery`
  only; other types raise "Unsupported source type". There is no condition, threshold or change detection: `type`
  only changes the email template and webhook event (`alert.executed` vs `report.generated`). Then it emails,
  fires webhooks, writes `AlertExecution`, and advances `next_run`. `execute_alert_now` backs the test endpoints.
- Email (`services/email_service.py`): synchronous `smtplib` + STARTTLS; returns False when SMTP is not
  configured (the run is still marked success). Templates interpolate name, question and answer as raw HTML.

## Outgoing webhooks (`services/webhook_dispatcher.py`, `routers/webhook_router.py`)

- `Webhook(user_id, agent_id?, url, secret, events[], headers{}, is_active)`, user-personal (no org column).
  Secret defaults to `secrets.token_hex(32)`, shown once.
- Body: `{"event", "data": {alert_id, alert_name, alert_type, question, answer, agent_id, agent_name},
  "timestamp"}`; header `X-Webhook-Signature: hex(HMAC-SHA256(secret, raw_body))`.
- Match: same user, active, `agent_id` equal or NULL, empty `events` = all.
- Retries: `MAX_RETRIES = 3`, sleeps `RETRY_DELAYS[attempt]` between attempts (2 s, 4 s; the 8 is never used),
  retries any status ≥ 400, 15 s timeout, inline in the scheduler.

## Chat bots

All three build `AskQuestionRequest(question, agentId=conn.agent_id, channel=…)` and call `ask_question`; replies
are **text only** (no chart image), truncated to 4000 (Telegram, Slack) / 4096 (WhatsApp) characters.

- **Telegram** (`telegram_bot.py`, `routers/telegram_router.py`): long polling (`getUpdates`, timeout 50) per bot,
  supervisor re-syncs bots every 10 s. Linking: owner calls `POST /api/telegram/connection-link/{agent_id}` →
  15-minute single-use token → `https://t.me/<bot>?startgroup=<token>` → `/start <token>` upserts
  `TelegramConnection(chat_id → agent_id)`. In groups it only answers `/ask`, @mentions or replies to the bot.
  Sends Markdown first, then falls back to plain text.
- **WhatsApp** (`whatsapp_bot.py`, `routers/whatsapp_router.py`): `GET /api/whatsapp/webhook` echoes
  `hub.challenge` when `hub.verify_token` matches; `POST /webhook` queues text messages with `BackgroundTasks`;
  replies through Graph `v18.0/{phone_number_id}/messages`.
- **Slack** (`slack_bot.py`, `routers/slack_router.py`): `verify_slack_signature` (v0 basestring, HMAC-SHA256,
  5-minute window, `compare_digest`); events + slash commands; replies in thread; OAuth install with a 15-minute
  single-use state.

## MCP server and public API

- `mcp_server.py`: FastMCP over SSE mounted at `/mcp` when `mcp_enabled` (default on). 24 tools (agents, sources,
  sessions, LLM configs, alerts, `ask_question`); each takes an `api_key` argument — there is no guest fallback —
  and returns text/markdown. Destructive tools require `confirm=True`. `_resolve_scope` turns the key into
  `(user, organization_id, role, default_agent_id)`.
- `routers/public_api_router.py`: `POST /v1/ask` (mounted without the `/api` prefix; CLAUDE.md's `/api/v1/ask` is
  wrong). Auth via `get_api_key_user`; agent from `api_key.agent_id`; `sql_mode` can be overridden per request.

## How to add or change a channel

1. Resolve a real `TenantScope` (org + role) for the caller — from the API key, the linked connection's org, or the
   alert's org — and pass it to `ask_question`/`dispatch_question`. Never load Agent/Source/QASession by id alone.
2. Verify inbound requests and **fail closed**: reject when the signing secret is missing, check Slack v0, Meta
   `X-Hub-Signature-256`, Telegram secret token; never let the payload choose the recipient.
3. Acknowledge fast, run the LLM in the background (Slack expects a response within 3 s; dedupe retries with
   `X-Slack-Retry-Num`).
4. Outbound: HTML-escape LLM output in email, guard webhook URLs against SSRF, set custom headers before the
   signature, retry only on 5xx/network errors.
5. Pass `sessionId` if the channel should keep conversation history.

## Known pitfalls in the current code (verified)

- **Every bot answer fails.** `telegram_bot.py`, `slack_bot.py` (twice) and `whatsapp_bot.py` call
  `ask_question(request, db, user)` with a `User`, but the third parameter is now `scope: TenantScope`;
  `scope.user.id` raises and the bot replies with its generic error. They also send no `sessionId`.
- WhatsApp `POST /webhook` has no `X-Hub-Signature-256` check — a forged payload can trigger questions and pick the
  phone number that receives the answer. The verify-token comparison is not constant-time.
- Slack routes check `if signing_secret and not verify_slack_signature(...)` → fail open when the secret is empty
  (OAuth-created configs can have `signing_secret=""`); an empty timestamp header raises (500); the LLM runs inside
  the 3 s window; `.env` configs stored as `slack_bot_config_id="env"` are silently ignored; the OAuth callback
  reflects `error` into HTML unescaped.
- Scheduler: loads agent/sources/LlmConfig by id without tenant filter, never calls `unlock_source_metadata`;
  alert create does not check that `agentId` belongs to the tenant; recipients are unverified; no lease, so with N
  replicas each alert runs N times; one slow LLM call delays all alerts.
- `_compute_next_run`: the weekly default `1  # default Monday` is Tuesday; `"hourly"` (accepted by MCP) runs daily.
- Webhooks: custom headers can overwrite `X-Webhook-Signature`; `last_status_code` is overwritten with 200/0;
  no SSRF guard; no event id or timestamp header for replay protection.
- MCP: `ask_question`/`list_sources` read any tenant's agent with any valid key; role is never checked;
  `upload_file_source` reads any server path (including the SQLite platform DB); `create_alert` omits
  `organization_id`.
- Public API: no membership check on the key owner; session history loaded by id without owner check;
  the response omits `generatedSql`.

## Checks before you finish

- No tests cover bots, MCP, public API, alerts or webhooks: add one for the path you change (mock
  `chat_completion`/`record_log`; assert the scope and the cross-tenant 404).
- `cd backend && ruff check --select F821 app && pytest -q`

General version: `data-analytics:data-reports-and-alerts` and `data-analytics:secure-data-platform` in
https://github.com/Empreiteiro/skills
