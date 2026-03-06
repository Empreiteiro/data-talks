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


class AskQuestionResponse(BaseModel):
    answer: str
    imageUrl: Optional[str] = None
    sessionId: Optional[str] = None
    followUpQuestions: list[str] = []
    turnId: Optional[str] = None
    chartInput: Optional[dict[str, Any]] = None


# Other CRUD schemas can be added as needed by the frontend
