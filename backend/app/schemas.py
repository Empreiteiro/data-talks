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
