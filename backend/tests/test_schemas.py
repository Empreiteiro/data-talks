"""Unit tests for Pydantic schemas."""
import pytest
from pydantic import ValidationError
from app.schemas import (
    UserCreate,
    LoginBody,
    Token,
    UserOut,
    AskQuestionRequest,
    AskQuestionResponse,
    ApiKeyCreate,
)


class TestUserCreate:
    def test_valid_user(self):
        u = UserCreate(email="test@example.com", password="secret")
        assert u.email == "test@example.com"
        assert u.password == "secret"

    def test_invalid_email_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(email="not-an-email", password="secret")

    def test_missing_password_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(email="test@example.com")


class TestLoginBody:
    def test_username_login(self):
        lb = LoginBody(username="admin", password="pass")
        assert lb.username == "admin"
        assert lb.password == "pass"
        assert lb.email is None

    def test_email_login(self):
        lb = LoginBody(email="user@example.com", password="pass")
        assert lb.email == "user@example.com"
        assert lb.username is None

    def test_missing_password_raises(self):
        with pytest.raises(ValidationError):
            LoginBody(username="admin")


class TestToken:
    def test_valid_token(self):
        t = Token(access_token="abc.def.ghi", user={"id": "1", "email": "a@b.com"})
        assert t.token_type == "bearer"
        assert t.access_token == "abc.def.ghi"


class TestUserOut:
    def test_valid_user_out(self):
        u = UserOut(id="uuid-123", email="x@y.com", role="user")
        assert u.organization_id is None

    def test_with_org(self):
        u = UserOut(id="uuid-1", email="x@y.com", role="admin", organization_id="org-1")
        assert u.organization_id == "org-1"


class TestAskQuestionRequest:
    def test_minimal(self):
        req = AskQuestionRequest(question="What is the total?", agentId="agent-1")
        assert req.sessionId is None
        assert req.channel is None

    def test_full(self):
        req = AskQuestionRequest(
            question="Show me sales",
            agentId="agent-1",
            userId="user-1",
            sessionId="sess-1",
            channel="workspace",
        )
        assert req.channel == "workspace"

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            AskQuestionRequest(question="Q?")  # missing agentId


class TestAskQuestionResponse:
    def test_defaults(self):
        resp = AskQuestionResponse(answer="42")
        assert resp.imageUrl is None
        assert resp.followUpQuestions == []
        assert resp.chartInput is None

    def test_with_follow_up(self):
        resp = AskQuestionResponse(
            answer="Here are the results",
            followUpQuestions=["What about last month?", "Compare by region?"],
        )
        assert len(resp.followUpQuestions) == 2


class TestApiKeyCreate:
    def test_valid(self):
        k = ApiKeyCreate(agent_id="agent-1", name="My Key")
        assert k.name == "My Key"

    def test_missing_name_raises(self):
        with pytest.raises(ValidationError):
            ApiKeyCreate(agent_id="agent-1")
