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


# Public API
class PublicAskRequest(BaseModel):
    question: str
    source_ids: Optional[list[str]] = None   # subset of agent sources; None = use all
    sql_mode: Optional[bool] = None          # override agent default; None = use agent setting
    session_id: Optional[str] = None
