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
    workspace_type: Mapped[str] = mapped_column(String(30), default="analysis")  # analysis | cdp | etl
    workspace_config: Mapped[dict] = mapped_column(JSON, default=dict)  # type-specific configuration
    source_ids: Mapped[list] = mapped_column(JSON, default=list)  # list of UUIDs
    source_relationships: Mapped[list] = mapped_column(JSON, default=list)
    dismissed_relationship_suggestions: Mapped[list] = mapped_column(JSON, default=list)  # keys of excluded suggestions
    suggested_questions: Mapped[list] = mapped_column(JSON, default=list)
    llm_config_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # which LLM config to use
    sql_mode: Mapped[bool] = mapped_column(Boolean, default=False)  # when True, answer with SQL query instead of elaborated result
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


class LlmConfig(Base):
    """Multiple LLM configurations per user. User selects one per workspace/agent."""
    __tablename__ = "llm_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(128))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)  # used for new workspaces
    llm_provider: Mapped[str] = mapped_column(String(20), default="openai")  # openai | ollama | litellm | google | anthropic | claude-code
    openai_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    openai_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    openai_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    openai_audio_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ollama_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ollama_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    litellm_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_audio_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    google_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    google_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    anthropic_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    anthropic_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claude_code_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claude_code_oauth_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class LlmSettings(Base):
    """Per-user LLM configuration. Falls back to env vars when not set."""
    __tablename__ = "llm_settings"
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    llm_provider: Mapped[str] = mapped_column(String(20), default="openai")  # openai | ollama | litellm | google | anthropic | claude-code
    openai_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    openai_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    openai_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    openai_audio_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ollama_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ollama_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_base_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    litellm_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_audio_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    litellm_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    google_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    google_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    anthropic_api_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    anthropic_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claude_code_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claude_code_oauth_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(50), default="alert")  # alert | report
    question: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(String(255))
    frequency: Mapped[str] = mapped_column(String(50))
    execution_time: Mapped[str] = mapped_column(String(20))
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(50), nullable=True)  # success | error
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AlertExecution(Base):
    """Tracks each execution of an alert."""
    __tablename__ = "alert_executions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    alert_id: Mapped[str] = mapped_column(String(36), ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(50))  # success | error
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    webhooks_fired: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Webhook(Base):
    """Outgoing webhook that fires when alert conditions are met."""
    __tablename__ = "webhooks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(1024))
    secret: Mapped[str | None] = mapped_column(String(512), nullable=True)  # HMAC secret
    events: Mapped[list] = mapped_column(JSON, default=list)  # ["alert.executed", "report.generated"]
    headers: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # custom headers
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PlatformLog(Base):
    """Platform-wide LLM activity log (pergunta, summary, etc.). Persisted in DB."""
    __tablename__ = "platform_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    action: Mapped[str] = mapped_column(String(50))  # pergunta | summary
    channel: Mapped[str | None] = mapped_column(String(50), nullable=True)  # workspace | telegram | studio
    provider: Mapped[str] = mapped_column(String(50))  # openai | ollama | litellm
    model: Mapped[str] = mapped_column(String(128))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)  # data source name
    trace: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # LLM trace: tool_calls, reasoning, etc.
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


class AudioOverview(Base):
    """Studio Audio: concise spoken overview for a source, generated via LLM + TTS."""
    __tablename__ = "audio_overviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    source_id: Mapped[str] = mapped_column(String(36))
    source_name: Mapped[str] = mapped_column(String(255))
    script: Mapped[str] = mapped_column(Text)
    audio_file_path: Mapped[str] = mapped_column(String(512))
    mime_type: Mapped[str] = mapped_column(String(64), default="audio/mpeg")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TelegramBotConfig(Base):
    """User-managed Telegram bot credentials shown in the Connections screen."""
    __tablename__ = "telegram_bot_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(128))
    bot_token: Mapped[str] = mapped_column(String(512))
    bot_username: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TelegramLinkToken(Base):
    """Temporary token to link a Telegram group to an agent."""
    __tablename__ = "telegram_link_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    bot_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    bot_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_bot_config_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class TelegramConnection(Base):
    """Maps a Telegram chat (group or private) to an agent."""
    __tablename__ = "telegram_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    chat_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    chat_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bot_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    bot_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telegram_bot_config_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WhatsAppBotConfig(Base):
    """User-managed WhatsApp Business API credentials."""
    __tablename__ = "whatsapp_bot_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(128))
    phone_number_id: Mapped[str] = mapped_column(String(64))
    access_token: Mapped[str] = mapped_column(String(512))
    verify_token: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WhatsAppConnection(Base):
    """Maps a WhatsApp phone number ID to an agent."""
    __tablename__ = "whatsapp_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    whatsapp_bot_config_id: Mapped[str] = mapped_column(String(36))
    phone_number_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    config_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SlackBotConfig(Base):
    """User-managed Slack app credentials (obtained via OAuth2 or manual entry)."""
    __tablename__ = "slack_bot_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(128))
    client_id: Mapped[str] = mapped_column(String(128))
    client_secret: Mapped[str] = mapped_column(String(256))
    signing_secret: Mapped[str] = mapped_column(String(256))
    bot_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    team_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    team_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SlackOAuthState(Base):
    """Temporary state for Slack OAuth2 flow."""
    __tablename__ = "slack_oauth_states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    state: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    config_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class SlackConnection(Base):
    """Maps a Slack channel to an agent."""
    __tablename__ = "slack_connections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    slack_bot_config_id: Mapped[str] = mapped_column(String(36))
    team_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    channel_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    channel_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    """Full audit trail: tracks all user actions for enterprise compliance."""
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), index=True)  # e.g. source.create, agent.delete, user.login
    category: Mapped[str] = mapped_column(String(50), index=True)  # query, source, agent, config, user, auth
    resource_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # source, agent, llm_config, etc.
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # human-readable description
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AuditRetentionConfig(Base):
    """Audit log retention policy configuration."""
    __tablename__ = "audit_retention_config"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    retention_days: Mapped[int] = mapped_column(Integer, default=90)  # days to keep logs; 0 = forever
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AutoMLRun(Base):
    """Auto ML run: stores results of a simplified ML pipeline for a source."""
    __tablename__ = "automl_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    source_id: Mapped[str] = mapped_column(String(36))
    source_name: Mapped[str] = mapped_column(String(255))
    target_column: Mapped[str] = mapped_column(String(255))
    task_type: Mapped[str] = mapped_column(String(20))  # classification | regression
    model_type: Mapped[str] = mapped_column(String(50), default="random_forest")
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    feature_importance: Mapped[list] = mapped_column(JSON, default=list)
    report: Mapped[str] = mapped_column(Text)  # markdown explanation
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Report(Base):
    """Studio Report: rich HTML report with exploratory charts for a data source."""
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    source_id: Mapped[str] = mapped_column(String(36))
    source_name: Mapped[str] = mapped_column(String(255))
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    html_content: Mapped[str] = mapped_column(Text)
    chart_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReportTemplate(Base):
    """Report template: pre-configured set of queries and charts for a source type."""
    __tablename__ = "report_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)  # null = built-in
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)  # workspace scope
    source_type: Mapped[str] = mapped_column(String(50), index=True)  # csv | sql_database | bigquery | etc.
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    queries: Mapped[list] = mapped_column(JSON, default=list)  # list of query definitions
    layout: Mapped[str] = mapped_column(String(50), default="grid_2x2")
    refresh_interval: Mapped[int] = mapped_column(Integer, default=3600)  # seconds
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReportTemplateRun(Base):
    """Execution history for report template runs."""
    __tablename__ = "report_template_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    template_id: Mapped[str] = mapped_column(String(36), ForeignKey("report_templates.id"), index=True)
    status: Mapped[str] = mapped_column(String(20))  # success | error | partial
    results: Mapped[list] = mapped_column(JSON, default=list)  # [{query_id, title, rows, chart_spec, error}]
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApiKey(Base):
    """External API key for programmatic access to an agent."""
    __tablename__ = "api_keys"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(128))
    key_hash: Mapped[str] = mapped_column(String(512))  # SHA-256 of raw key
    key_prefix: Mapped[str] = mapped_column(String(12))  # first 12 chars for display ("dtk_XXXXXXXX")
    scopes: Mapped[list] = mapped_column(JSON, default=list)  # future: ["ask", "read_sources", ...]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Medallion Architecture (Bronze / Silver / Gold layers)
# ---------------------------------------------------------------------------

class MedallionLayer(Base):
    """One row per layer per source. Bronze and silver get one each; gold can have multiple."""
    __tablename__ = "medallion_layers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id"), index=True)
    agent_id: Mapped[str] = mapped_column(String(36))
    layer: Mapped[str] = mapped_column(String(10))  # bronze | silver | gold
    table_name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | ready | error
    schema_config: Mapped[dict] = mapped_column(JSON, default=dict)
    ddl_sql: Mapped[str] = mapped_column(Text, default="")
    transform_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MedallionBuildLog(Base):
    """Audit trail: every AI suggestion, redo, and apply action is logged."""
    __tablename__ = "medallion_build_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    layer_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("medallion_layers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(30))  # suggest | apply | redo | error
    layer: Mapped[str] = mapped_column(String(10))  # bronze | silver | gold
    input_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggestion: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    applied_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    llm_usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

