"""SQLAlchemy models aligned with frontend expectations."""
from datetime import datetime
from sqlalchemy import String, Text, Boolean, Integer, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    role: Mapped[str] = mapped_column(String(50), default="user")  # admin | user
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Source(Base):
    __tablename__ = "sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    organization_id: Mapped[str] = mapped_column(String(36))
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(50))  # csv | xlsx | bigquery | google_sheets | sql_database
    langflow_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    langflow_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    organization_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)  # list of UUIDs
    suggested_questions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class QASession(Base):
    __tablename__ = "qa_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    table_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # { image_url, table }
    latency: Mapped[int | None] = mapped_column(Integer, nullable=True)
    follow_up_questions: Mapped[list] = mapped_column(JSON, default=list)
    conversation_history: Mapped[list] = mapped_column(JSON, default=list)
    feedback: Mapped[str | None] = mapped_column(String(20), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Dashboard(Base):
    __tablename__ = "dashboards"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DashboardChart(Base):
    __tablename__ = "dashboard_charts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dashboard_id: Mapped[str] = mapped_column(String(36), ForeignKey("dashboards.id"))
    qa_session_id: Mapped[str] = mapped_column(String(36))
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LlmSettings(Base):
    """Per-user LLM configuration. Falls back to env vars when not set."""
    __tablename__ = "llm_settings"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    llm_provider: Mapped[str] = mapped_column(String(20), default="openai")  # openai | ollama | litellm
    openai_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    openai_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ollama_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ollama_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    litellm_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(255))
    question: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(String(255))
    frequency: Mapped[str] = mapped_column(String(50))
    execution_time: Mapped[str] = mapped_column(String(20))
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_run: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PlatformLog(Base):
    """Platform-wide LLM activity log (pergunta, summary, etc.). Persisted in DB."""
    __tablename__ = "platform_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    action: Mapped[str] = mapped_column(String(50))  # pergunta | summary
    provider: Mapped[str] = mapped_column(String(50))  # openai | ollama | litellm
    model: Mapped[str] = mapped_column(String(128))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)  # question preview, source name
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TableSummary(Base):
    """Studio Summary: executive report for a table/source, generated via LLM + analytical queries."""
    __tablename__ = "table_summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    source_id: Mapped[str] = mapped_column(String(36))
    source_name: Mapped[str] = mapped_column(String(255))
    report: Mapped[str] = mapped_column(Text)  # markdown executive summary
    queries_run: Mapped[list] = mapped_column(JSON, default=list)  # [{ "query": "...", "rows": [...] }]
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
