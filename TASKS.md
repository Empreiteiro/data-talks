# TASKS

Pending UX/feature work. Each task lists scope, acceptance criteria, and the files expected to change. Provider keys below match the codebase, not the UI labels:

| UI label             | Provider key in code |
| -------------------- | -------------------- |
| OpenAI-compatible    | `openai`             |
| Claude CLI           | `claude-code`        |
| LiteLLM              | `litellm`            |
| Ollama               | `ollama`             |
| Google Gemini        | `google`             |
| Anthropic Claude     | `anthropic`          |

---

## Task 1 — Claude CLI: model field as a fixed dropdown

**Goal.** When the user selects the **Claude CLI** provider while creating/editing an LLM config, the model field must become a `<Select>` populated with a curated list of valid Claude models (the values currently accepted by the Claude CLI/OAuth flow). No free-text input.

**Acceptance criteria.**
- Switching the provider to `claude-code` renders a select instead of an input.
- The list of options lives in a single constant (e.g. `CLAUDE_CODE_MODELS`) so it is easy to keep in sync with the backend.
- The default selected model preserves today's default (`claude-sonnet-4-20250514`) unless an existing config already has a stored value.
- If an existing config has a model that is not in the curated list (legacy), the select still shows it as the current value and lets the user keep or change it.

**Files to change.**
- [src/components/LLMPanel.tsx](src/components/LLMPanel.tsx) — replace the `<Input>` for `claudeCodeModel` (around line 619–629) with a `<Select>` over a new `CLAUDE_CODE_MODELS` constant. Adjust the load path (around line 211) so unknown stored values do not get wiped.
- [src/components/AgentSettingsModal.tsx](src/components/AgentSettingsModal.tsx) — if it surfaces the same model field, mirror the change.

**Files to verify (no change expected, but confirm the model list matches what the backend dispatch accepts).**
- [backend/app/llm/client.py](backend/app/llm/client.py) — `claude-code` branch in the provider dispatch (around line 128–139).
- [backend/app/routers/settings_router.py](backend/app/routers/settings_router.py) — `LlmConfigCreate` / `LlmConfigUpdate` schemas should not reject any value in the curated list.

---

## Task 2 — OpenAI-compatible: model field as combobox (dropdown + free text)

**Goal.** When the user selects the **OpenAI-compatible** provider, the model field must become a **combobox**: a dropdown with suggested models *and* the ability to type a custom model name (so users can target any model their proxy/endpoint exposes).

**Acceptance criteria.**
- The control is built with the existing shadcn primitives ([src/components/ui/command.tsx](src/components/ui/command.tsx) + [src/components/ui/popover.tsx](src/components/ui/popover.tsx)) — do not add a new dependency.
- The user can either (a) click an item from the suggested list, or (b) type any string and have it accepted as the model value.
- Suggestions are sourced from a curated list (e.g. `OPENAI_COMPATIBLE_MODELS`). When the OpenAI base URL exposes `/v1/models`, the form should also be able to fetch live suggestions on demand (button next to the field, mirroring the LiteLLM/Ollama refresh buttons already in the file).
- The combobox preserves any value already saved in `cfg.openai_model`, even if it is not in the suggestion list.

**Files to change.**
- [src/components/LLMPanel.tsx](src/components/LLMPanel.tsx) — replace the `<Input>` for `openaiModel` (around line 488–495) with the new combobox. Add a `OPENAI_COMPATIBLE_MODELS` constant. Add an optional "fetch models" handler that hits the new endpoint below (or reuses `/api/settings/litellm/models` against the user's OpenAI base URL).
- [src/services/apiClient.ts](src/services/apiClient.ts) — if a dedicated endpoint is added, expose `listOpenAiCompatibleModels(baseUrl)`.
- [backend/app/routers/settings_router.py](backend/app/routers/settings_router.py) — optionally add `GET /openai/models` mirroring the existing `GET /litellm/models` (around line 270–308) so the combobox can fetch models for the user-configured base URL. If reusing `/litellm/models` is acceptable, skip this and document it in the PR.

**Optional (recommended).** Extract a reusable `<ModelCombobox>` component under [src/components/](src/components/) so other providers can adopt the same pattern later without duplicating the popover + command boilerplate.

---

## Task 3 — Guided onboarding after adding data sources

**Goal.** When the user finishes adding one or more sources in the source form, kick off a guided LLM-driven flow that captures domain knowledge useful for future Q&A. The flow runs once per source (skippable), and persists everything it learns into workspace settings.

**Flow (high level).**
1. **Inspect.** The LLM receives a structured profile of each new source: list of tables, columns + types, and `head()` of the tables.
2. **Clarify.** It generates a small set of clarifying questions ("What does column `mrr_usd` represent?", "Which table is the source of truth for active users?") for the user to answer.
3. **Suggest warm-up questions.** It proposes N starter questions ("How many active customers per region in the last 30 days?"). The user clicks the ones they want to keep — those are saved as warm-up questions.
4. **Suggest KPIs.** It proposes candidate KPIs (name + definition + table/column it depends on). The user confirms/edits/discards.
5. **Persist.** All learnings (clarifications, saved warm-up questions, confirmed KPIs) are stored against the workspace/organization so subsequent Q&A can use them as context.

**Acceptance criteria.**
- The flow is reachable from the source-creation success state in [AddSourceModal.tsx](src/components/AddSourceModal.tsx); user can skip it.
- Source profile (tables, columns, sample rows) is built server-side, reusing existing introspection helpers — do not re-implement per source type in the frontend.
- Clarifications, warm-up questions, and confirmed KPIs are persisted in the database and available to the Q&A pipeline as additional system context.
- Re-opening the flow on an existing source shows previously captured learnings and lets the user edit them.

**Files to change — backend.**

- [backend/app/models.py](backend/app/models.py) — persistence model. Two reasonable options; pick one and document it in the PR:
  - **Option A (per-source, simpler):** extend `Source.metadata_` (line 76) with new keys: `onboarding_clarifications`, `warmup_questions`, `kpis`, `onboarding_completed_at`. No schema migration needed (it's a JSON column), but add typed accessors in `schemas.py`.
  - **Option B (workspace-wide, recommended):** add an `Organization.settings` JSON column (or a new `OrganizationKnowledge` table) so KPIs and clarifications can span multiple sources. Requires an Alembic migration under [backend/alembic/versions/](backend/alembic/versions/).
- [backend/app/schemas.py](backend/app/schemas.py) — add Pydantic models for `OnboardingProfile`, `OnboardingQuestion`, `WarmupQuestion`, `KpiSuggestion`, plus the create/update payloads.
- [backend/app/routers/](backend/app/routers/) — new router (e.g. `onboarding_router.py`) with endpoints:
  - `POST /sources/{id}/onboarding/profile` → returns tables/columns/heads + initial LLM-generated clarifying questions, warm-up questions, and KPI suggestions.
  - `POST /sources/{id}/onboarding/save` → persists user's answers, selected warm-up questions, and confirmed KPIs.
  - `GET /sources/{id}/onboarding` → returns currently saved learnings (for editing later).
- [backend/app/routers/crud.py](backend/app/routers/crud.py) — reuse `_build_sample_profile()` (lines 68–103) and the per-type introspection (e.g. `_introspect_sqlite_sync` from [backend/app/scripts/ask_sqlite.py](backend/app/scripts/ask_sqlite.py); analogous helpers in `ask_csv.py`, `ask_bigquery.py`, `ask_google_sheets.py`, `ask_postgres.py`, `ask_mysql.py`).
- [backend/app/llm/client.py](backend/app/llm/client.py) — add a helper that, given a source profile, prompts the configured LLM and returns the structured `(clarifying_questions, warmup_questions, kpis)` tuple. Reuse the existing chat dispatch — do not call provider SDKs directly.
- [backend/app/scripts/](backend/app/scripts/) — when the Q&A pipeline runs, inject saved clarifications/KPIs into the system prompt. Update each `ask_<type>.py` to read learnings from the chosen persistence location.

**Files to change — frontend.**

- [src/components/AddSourceModal.tsx](src/components/AddSourceModal.tsx) — after a successful source creation, transition the modal into the onboarding flow instead of closing. Support multiple sources created in the same session (queue them).
- [src/components/](src/components/) — new component (e.g. `SourceOnboarding.tsx`) implementing the four-step UX (profile preview → clarifications → warm-up question picker → KPI confirmation).
- [src/services/apiClient.ts](src/services/apiClient.ts) — add `getSourceOnboardingProfile`, `saveSourceOnboarding`, `getSourceOnboarding`.
- [src/pages/Workspace.tsx](src/pages/Workspace.tsx) — surface saved warm-up questions in the agent UI (the `Agent.suggested_questions` JSON list at [models.py](backend/app/models.py) line 93 already powers a similar UI — confirm whether warm-up questions should merge into it or stay separate).
- [src/pages/Account.tsx](src/pages/Account.tsx) — if workspace settings are exposed there, add a section to view/edit clarifications and KPIs.
- [src/contexts/LanguageContext.tsx](src/contexts/LanguageContext.tsx) — add PT/EN/ES strings for all new UI copy.

**Files to verify (existing patterns to reuse, not edit unless necessary).**
- [backend/app/routers/crud.py](backend/app/routers/crud.py) — `_build_sample_profile()` (lines 68–103); `POST /sources` (line 148) and `POST /sources/upload` (line 188) for where the trigger fires.
- [backend/app/models.py](backend/app/models.py) — `Agent.suggested_questions` (line 93) and `Agent.workspace_config` (line 89) as precedents for JSON-list persistence.

**Open decisions to lock in before starting.**
1. Per-source vs workspace-wide persistence (Option A vs B above).
2. Whether warm-up questions live on the source, on the agent (`Agent.suggested_questions`), or both.
3. Whether the LLM call is synchronous (blocking the flow) or returns via a job/poll pattern — matters because schema introspection on large warehouses can be slow.
