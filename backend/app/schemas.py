"""Pydantic schemas for request/response."""
from pydantic import BaseModel, EmailStr
from typing import Optional, Any
from datetime import datetime


# Auth
class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class LoginBody(BaseModel):
    """Login: when ENABLE_LOGIN use username+password; else email+password."""
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserOut(BaseModel):
    id: str
    email: str
    role: str
    organization_id: Optional[str] = None


# Ask question
class AskQuestionRequest(BaseModel):
    question: str
    agentId: str
    userId: Optional[str] = None
    sessionId: Optional[str] = None
    channel: Optional[str] = None


class AskQuestionResponse(BaseModel):
    answer: str
    imageUrl: Optional[str] = None
    sessionId: Optional[str] = None
    followUpQuestions: list[str] = []
    turnId: Optional[str] = None
    chartInput: Optional[dict[str, Any]] = None


# API Keys
class ApiKeyCreate(BaseModel):
    agent_id: str
    name: str


class ApiKeyOut(BaseModel):
    id: str
    agent_id: str
    name: str
    key_prefix: str
    scopes: list[str] = []
    is_active: bool
    last_used_at: Optional[str] = None
    created_at: str


class ApiKeyCreated(ApiKeyOut):
    """Returned only at creation time — includes the raw key."""
    raw_key: str


# Report Templates
class TemplateQueryDef(BaseModel):
    id: str
    title: str
    sql: str
    chart_type: str = "bar"
    chart_config: dict = {}


class ReportTemplateOut(BaseModel):
    id: str
    name: str
    sourceType: str
    description: Optional[str] = None
    queries: list[TemplateQueryDef] = []
    layout: str = "grid_2x2"
    refreshInterval: int = 3600
    isBuiltin: bool = False
    queryCount: int = 0


class TemplateRunRequest(BaseModel):
    filters: Optional[dict] = None
    dateRange: Optional[dict] = None  # {"start": "...", "end": "..."}
    disabledQueries: Optional[list[str]] = None


class TemplateQueryResult(BaseModel):
    queryId: str
    title: str
    rows: list[dict] = []
    chartSpec: Optional[dict] = None
    error: Optional[str] = None


class TemplateRunResponse(BaseModel):
    runId: str
    templateId: str
    templateName: str
    status: str  # success | error | partial
    results: list[TemplateQueryResult] = []
    durationMs: Optional[int] = None
    createdAt: str


# Public API
class PublicAskRequest(BaseModel):
    question: str
    source_ids: Optional[list[str]] = None   # subset of agent sources; None = use all
    sql_mode: Optional[bool] = None          # override agent default; None = use agent setting
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Medallion Architecture
# ---------------------------------------------------------------------------

class BronzeGenerateRequest(BaseModel):
    sourceId: str
    agentId: str


class SilverSuggestRequest(BaseModel):
    sourceId: str
    agentId: str
    feedback: Optional[str] = None  # when present, acts as "redo with direction"


class SilverApplyRequest(BaseModel):
    sourceId: str
    agentId: str
    buildLogId: str
    config: dict  # user-edited silver suggestion


class GoldSuggestRequest(BaseModel):
    sourceId: str
    agentId: str
    feedback: Optional[str] = None
    reportPrompt: Optional[str] = None  # user describes the report they want to build


class GoldApplyRequest(BaseModel):
    sourceId: str
    agentId: str
    buildLogId: str
    selectedTables: list[dict]  # list of gold aggregate configs to materialize


class MedallionLayerOut(BaseModel):
    id: str
    sourceId: str
    agentId: str
    layer: str
    tableName: str
    status: str
    schemaConfig: dict = {}
    ddlSql: str = ""
    transformSql: Optional[str] = None
    rowCount: Optional[int] = None
    errorMessage: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class MedallionBuildLogOut(BaseModel):
    id: str
    layerId: Optional[str] = None
    action: str
    layer: str
    inputFeedback: Optional[str] = None
    suggestion: Optional[dict] = None
    appliedConfig: Optional[dict] = None
    llmUsage: Optional[dict] = None
    errorMessage: Optional[str] = None
    createdAt: Optional[str] = None


class SilverSuggestResponse(BaseModel):
    suggestion: dict
    ddlPreview: str
    transformPreview: str
    buildLogId: str


class GoldSuggestResponse(BaseModel):
    suggestions: list[dict]
    ddlPreviews: list[str] = []
    buildLogId: str


# ---------------------------------------------------------------------------
# Source onboarding (Task 3): payloads exchanged between the
# `SourceOnboarding` UI and the onboarding router.
#
# Shape rationale: "suggested" and "saved" are kept as separate types
# because the LLM call returns more than what the user actually
# confirms. The `Saved` payloads mirror what gets persisted to
# SourceClarification / Agent.suggested_questions / OrganizationKpi —
# free-text edits are allowed before save.
# ---------------------------------------------------------------------------


class OnboardingClarificationSuggestion(BaseModel):
    """LLM-generated clarifying question with no user answer yet."""
    question: str


class OnboardingClarificationSaved(BaseModel):
    """A clarification the user confirmed (with their answer). `id` lets
    the UI re-edit existing rows on a second pass through the flow."""
    id: Optional[str] = None
    question: str
    answer: str


class OnboardingWarmupQuestion(BaseModel):
    """Suggested or saved warm-up question. Plain string in JSON, but
    we wrap it so the API stays extensible (e.g. add `category` later)."""
    text: str


class OnboardingKpiSuggestion(BaseModel):
    """LLM-generated KPI candidate. `dependencies` is a free-form dict
    (typically `{"tables": [...], "columns": [...]}`) — see the
    OrganizationKpi model for why."""
    name: str
    definition: str
    dependencies: dict = {}


class OnboardingKpiSaved(BaseModel):
    """KPI the user confirmed/edited. `source_ids` is filled by the
    server (it's always at least the source the flow was opened from);
    the client may add more if it wants the KPI to span sources."""
    id: Optional[str] = None
    name: str
    definition: str
    dependencies: dict = {}
    source_ids: list[str] = []


class OnboardingFilterSuggestion(BaseModel):
    """LLM-generated filter candidate. `kind` is "date" or "category";
    `config` is loose: `{}` for dates (defaults inferred at query
    time) or `{"values": [...]}` for categories. See SourceFilter."""
    name: str
    column: str
    kind: str  # "date" | "category"
    config: dict = {}


class OnboardingFilterSaved(BaseModel):
    """Filter the user confirmed/edited. `source_ids` filled by the
    server (always includes the onboarded source)."""
    id: Optional[str] = None
    name: str
    column: str
    kind: str
    config: dict = {}
    source_ids: list[str] = []


class SourceGroupCreate(BaseModel):
    """Upsert a SourceGroup by (agent_id, source_ids set)."""
    agent_id: Optional[str] = None
    source_ids: list[str]


class SourceGroupResponse(BaseModel):
    id: str
    agent_id: Optional[str] = None
    source_ids: list[str]
    instructions: str = ""
    onboarding_completed_at: Optional[str] = None


class OnboardingProfileResponse(BaseModel):
    """Returned by `POST /sources/{id}/onboarding/profile` — the source
    profile the LLM saw, plus its initial suggestions."""
    profile: dict
    clarifications: list[OnboardingClarificationSuggestion] = []
    warmup_questions: list[OnboardingWarmupQuestion] = []
    kpis: list[OnboardingKpiSuggestion] = []
    filters: list[OnboardingFilterSuggestion] = []


class OnboardingSaveRequest(BaseModel):
    """User-confirmed onboarding output. All fields are optional —
    skipping the flow saves nothing but still marks the source as
    onboarded so we don't keep prompting.

    `agent_instructions` mirrors the "Specific Instructions for the
    Agent" textarea in the agent-settings modal — it's a free-form
    prompt the user wants every Q&A on this agent to start from.
    Persisted to `Agent.description`. None = leave the existing
    value untouched; empty string = explicitly clear it.
    """
    clarifications: list[OnboardingClarificationSaved] = []
    warmup_questions: list[OnboardingWarmupQuestion] = []
    kpis: list[OnboardingKpiSaved] = []
    filters: list[OnboardingFilterSaved] = []
    agent_instructions: Optional[str] = None
    # Source-scoped instructions — additional prompt that ONLY applies
    # when this source is active in a workspace, layered on top of
    # `agent_instructions` (the workspace-wide prompt). Persisted to
    # `Source.metadata_["onboarding_instructions"]`. Same None/""
    # semantics as `agent_instructions`: None = leave untouched,
    # "" = explicitly clear.
    source_instructions: Optional[str] = None


class OnboardingSavedResponse(BaseModel):
    """Returned by `POST /sources/{id}/onboarding/save` and
    `GET /sources/{id}/onboarding`."""
    clarifications: list[OnboardingClarificationSaved] = []
    warmup_questions: list[OnboardingWarmupQuestion] = []
    kpis: list[OnboardingKpiSaved] = []
    filters: list[OnboardingFilterSaved] = []
    onboarding_completed_at: Optional[str] = None
    # Mirror of `Agent.description` for the active agent of this
    # source. Empty string when unset / no agent. The UI uses this to
    # pre-fill the "Specific Instructions for the Agent" textarea on
    # the final onboarding step so re-opens show the saved value.
    agent_instructions: str = ""
    # Mirror of `Source.metadata_["onboarding_instructions"]`. Empty
    # string when unset.
    source_instructions: str = ""
