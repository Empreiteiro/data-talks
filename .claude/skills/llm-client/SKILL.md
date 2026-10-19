---
name: llm-client
description: How Data Talks calls LLMs — the provider-agnostic `chat_completion` client, provider/config resolution (workspace config → user default → env), the Claude Code OAuth/CLI path, JSON-by-prompt contracts with defensive parsing, activity logging, TTS and language handling. Use when adding or changing any LLM call, touching `backend/app/llm/client.py`, `llm/logs.py`, `_llm_config_to_overrides`/`resolve_agent_llm_overrides` in `routers/ask.py`, Settings → LLM, or the logs/usage endpoints.
---

# LLM client

Rule from `backend/CLAUDE.md`: every LLM call goes through `app/llm/client.py`. Never import the OpenAI or
Anthropic SDK in routers or scripts.

## How it works

### `chat_completion(messages, max_tokens=4096, llm_overrides=None) -> (content, usage, trace)`
- `usage = {provider, model, input_tokens, output_tokens}`.
- `trace` (`_build_trace`): messages count/roles, input messages and output (each truncated to 30k chars), prompt
  preview, finish reason, tool calls, reasoning. Callers add `trace["stage"]` (`pergunta_main`, `elaborate`,
  `refine_followups`, `summary_sql_queries`, …) and `trace["source_type"]`.
- `_effective_settings(overrides)` starts from env `Settings` and applies an override only when it is
  `not None and != ""` — an empty LlmConfig field silently falls back to env.

| `llm_provider` | Transport | Default model |
|---|---|---|
| `openai` (fallthrough) | `AsyncOpenAI` | `gpt-4o-mini` |
| `ollama` | OpenAI-compatible `{base}/v1`, key `"ollama"` | env |
| `litellm` | OpenAI-compatible proxy, key defaults to `"not-needed"` | env |
| `google` | OpenAI-compatible Gemini endpoint | `gemini-2.0-flash` |
| `anthropic` | Anthropic SDK; all system messages concatenated into `system=` | `claude-sonnet-4-20250514` |
| `claude-code` | decision tree below | `claude_code_model`; API path falls back to `claude-sonnet-4-20250514`, CLI to its own default |

`claude-code` decision tree (`_claude_code_chat`):
1. Any OAuth token found (config → env `CLAUDE_CODE_OAUTH_TOKEN` → `~/.claude/oauth_token` →
   `~/.last-intelligence/claude_oauth_token`) → `_claude_code_via_api`: `AsyncAnthropic(api_key=None,
   auth_token=…)`, header `anthropic-beta: oauth-2025-04-20`, system block 0 must be
   `"You are Claude Code, Anthropic's official CLI for Claude."`, 429 → "Try again in ~Ns" from `retry-after`.
2. No token but the `claude` binary exists → subprocess `claude -p "" --output-format stream-json --verbose`,
   prompt piped via **stdin** (large prompts exceeded ARG_MAX and the CLI exited 1 silently), errors read from
   stream-json `is_error` lines (stderr was empty), `CLAUDE_CODE_OAUTH_TOKEN` removed from the child env, usage
   **estimated** as chars/4.
3. Neither → raise with an install/login hint.

### Config resolution (one mapper, one chain)
- `_llm_config_to_overrides(cfg)` in `routers/ask.py` is the **only** LlmConfig/LlmSettings → overrides mapper.
  Divergent copies once dropped `claude_code_*`, `anthropic_*`, `google_*` fields and fell through to a stale token
  → 401 (commit 9bf045b). Other routers import or re-export it.
- `resolve_agent_llm_overrides(db, agent, user_id)`: `agent.llm_config_id` (must belong to the user) → the user's
  `is_default` config (0494b58) → `None` = env. `ask_question` then returns **400 "No LLM configured…"** when the
  env has no OpenAI key, instead of an opaque provider 401.
- Incidents worth remembering: 22d2d2e/82f22b1 (any discovered OAuth token goes to the Messages API, never the CLI);
  e428966 bypassed the SDK with httpx and was reverted by 9bf045b after reading the SDK source confirmed
  `api_key=None` sends no `X-Api-Key`; 8a9ab4e (stdin, stream-json errors, neutral test prompt).

### JSON contracts
- No `response_format`, JSON mode, tools or `temperature` anywhere: the same path must work on OpenAI, Anthropic,
  Ollama, LiteLLM, Gemini and Claude Code. Contracts are prompt-only ("Return ONLY valid JSON with keys …"),
  parsed defensively: strip ```` ```json ```` fences → `json.loads` → slice first `{` to last `}` → fallback.
- Decide the failure policy explicitly per call: **raise** when a silent default would mislead (onboarding → 502),
  **degrade** when empty is a valid state (relationship suggestions → `[]`, chart → heuristic, Q&A → raw text).

### Logging (`llm/logs.py`)
- `record_log(action, provider, model, input_tokens, output_tokens, source, channel, trace)` writes a
  `PlatformLog` through its **own** `AsyncSessionLocal` session. Actions: `pergunta`, `summary`, `report`,
  `automl`, …; channels: `workspace, telegram, whatsapp, slack, mcp, api, alert, studio`.
- Lesson b469ae0: on SQLite, a request that flushed (opening a write transaction) and then awaited an LLM call
  blocked `record_log`'s second session → "database is locked". **Never hold an app-DB write transaction across an
  LLM or external call**; assign ids client-side and flush/commit at the end.

### TTS and language
- `synthesize_speech`: only `openai`/`litellm` with an audio model (`get_audio_model`), voice `alloy`, mp3, 120 s.
- Generated artifacts set language explicitly: onboarding `_lang_instruction`, summaries/reports/templates
  `LANGUAGE_NAMES` (`"Write ALL text output in {lang}."`). Q&A has no language directive and relies on the model
  mirroring the question.

## How to add an LLM call
1. Resolve overrides with `resolve_agent_llm_overrides` (agent context) — do not write another resolution chain.
2. Build `[{"role": "system", …}, {"role": "user", …}]`; put the JSON schema in the system prompt and end the user
   message with the data.
3. `content, usage, trace = await chat_completion(messages, max_tokens=…, llm_overrides=overrides)`.
4. `trace["stage"] = "<stage>"`; `await record_log(action=…, …, channel=channel, trace=trace)`.
5. Parse defensively, validate against the real schema, choose raise vs degrade.
6. Pass an explicit language when the output is user-facing prose.

## Known pitfalls in the current code
- Resolution chains are still duplicated: `onboarding_router._resolve_llm_overrides(_for_agent)`,
  `sql_router._resolve_llm_overrides_for_agent`, `medallion_router._resolve_llm_overrides` (adds legacy
  `LlmSettings`), `audio_overview_router._effective_llm_overrides`, `mcp_server._resolve_llm_overrides`,
  `etl_router`, `alert_scheduler`. `automl_router._user_llm_overrides` is a divergent mapper missing the
  anthropic/google/claude-code fields and filters LlmConfig without `user_id`.
- Not logged: onboarding suggestions, chart plans, audio scripts, relationship suggestions, the settings test.
- Settings test (`settings_router.py`, prompt "Reply with the digit 4 only. What is 2+2?") reads
  `overrides.get(f"{provider}_model")`, which builds `claude-code_model` instead of `claude_code_model`.
- `PlatformLog` has no `user_id`/`organization_id`; `GET /logs` and `/usage/*` use `require_user` only, so any user
  sees every tenant's logs, including traces with prompts and sample rows. `/usage/summary` prices at OpenAI rates.
- Q&A may answer in the wrong language and error strings are Portuguese.

## Checks before you finish
- `cd backend && pytest -q` (mock `chat_completion` and `record_log` like `tests/test_automl.py`).
- Settings → LLM → Test for each provider you touched; ask one question and confirm a `PlatformLog` row with the
  right `stage` and `channel`.

General version: `data-analytics:llm-structured-output` in https://github.com/Empreiteiro/skills
