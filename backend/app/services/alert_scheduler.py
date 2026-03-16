"""Background alert scheduler: checks for due alerts, executes them, sends emails & webhooks."""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Alert, AlertExecution, Agent, Source, User, LlmConfig
from app.services.email_service import (
    send_email, build_alert_email, build_report_email, is_smtp_configured,
)
from app.services.webhook_dispatcher import dispatch_webhooks

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 60  # check every minute


def _compute_next_run(alert: Alert, from_time: datetime | None = None) -> datetime:
    """Compute the next run datetime based on frequency, execution_time, day_of_week/month."""
    now = from_time or datetime.utcnow()
    parts = (alert.execution_time or "09:00").split(":")
    hour = int(parts[0]) if parts else 9
    minute = int(parts[1]) if len(parts) > 1 else 0

    if alert.frequency == "daily":
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    elif alert.frequency == "weekly":
        dow = alert.day_of_week if alert.day_of_week is not None else 1  # default Monday
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        days_ahead = (dow - candidate.weekday()) % 7
        if days_ahead == 0 and candidate <= now:
            days_ahead = 7
        candidate += timedelta(days=days_ahead)
        return candidate

    elif alert.frequency == "monthly":
        dom = alert.day_of_month or 1
        candidate = now.replace(day=min(dom, 28), hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            if now.month == 12:
                candidate = candidate.replace(year=now.year + 1, month=1)
            else:
                candidate = candidate.replace(month=now.month + 1)
        return candidate

    # fallback: tomorrow
    return now + timedelta(days=1)


async def _execute_single_alert(alert: Alert) -> None:
    """Execute one alert: ask the agent, send email, fire webhooks."""
    start = time.monotonic()
    exec_id = str(uuid.uuid4())
    status = "error"
    answer = None
    error_msg = None
    email_sent = False
    webhooks_fired = 0

    async with AsyncSessionLocal() as db:
        try:
            # Load agent
            r = await db.execute(select(Agent).where(Agent.id == alert.agent_id))
            agent = r.scalar_one_or_none()
            if not agent:
                raise ValueError(f"Agent {alert.agent_id} not found")

            # Load user
            r = await db.execute(select(User).where(User.id == alert.user_id))
            user = r.scalar_one_or_none()
            if not user:
                raise ValueError(f"User {alert.user_id} not found")

            # Load sources
            if agent.source_ids:
                r = await db.execute(select(Source).where(Source.id.in_(agent.source_ids)))
            else:
                r = await db.execute(select(Source).where(Source.agent_id == agent.id))
            sources = list(r.scalars().all())
            if not sources:
                raise ValueError(f"No sources for agent {agent.id}")

            active_sources = [s for s in sources if s.is_active]
            source = active_sources[0] if active_sources else sources[0]

            # LLM overrides
            from app.routers.ask import _llm_config_to_overrides
            llm_overrides = None
            if agent.llm_config_id:
                r_cfg = await db.execute(select(LlmConfig).where(LlmConfig.id == agent.llm_config_id))
                cfg = r_cfg.scalar_one_or_none()
                if cfg:
                    llm_overrides = _llm_config_to_overrides(cfg)

            from app.config import get_settings
            settings = get_settings()

            # Route by source type
            sql_mode = getattr(agent, "sql_mode", False)
            result = None

            if source.type in ("csv", "xlsx"):
                from app.scripts.ask_csv import ask_csv
                meta = source.metadata_ or {}
                result = await ask_csv(
                    file_path=meta.get("file_path", ""),
                    question=alert.question,
                    agent_description=agent.description or "",
                    source_name=source.name,
                    columns=meta.get("columns"),
                    preview_rows=meta.get("preview_rows"),
                    sample_profile=meta.get("sample_profile"),
                    sample_row_count=meta.get("sample_row_count") or meta.get("row_count"),
                    data_files_dir=settings.data_files_dir,
                    llm_overrides=llm_overrides,
                    history=[],
                    channel="alert",
                )
            elif source.type == "google_sheets":
                from app.scripts.ask_google_sheets import ask_google_sheets
                meta = source.metadata_ or {}
                result = await ask_google_sheets(
                    spreadsheet_id=meta.get("spreadsheetId", ""),
                    sheet_name=meta.get("sheetName", "Sheet1"),
                    available_columns=meta.get("availableColumns") or meta.get("available_columns"),
                    question=alert.question,
                    agent_description=agent.description or "",
                    source_name=source.name,
                    llm_overrides=llm_overrides,
                    history=[],
                    channel="alert",
                )
            elif source.type == "sql_database":
                from app.scripts.ask_sql import ask_sql
                meta = source.metadata_ or {}
                result = await ask_sql(
                    connection_string=meta.get("connectionString", ""),
                    question=alert.question,
                    agent_description=agent.description or "",
                    source_name=source.name,
                    table_infos=meta.get("table_infos"),
                    llm_overrides=llm_overrides,
                    history=[],
                    channel="alert",
                    sql_mode=sql_mode,
                )
            elif source.type == "bigquery":
                from app.scripts.ask_bigquery import ask_bigquery
                meta = source.metadata_ or {}
                creds = meta.get("credentialsContent") or meta.get("credentials_content")
                if not creds:
                    raise ValueError("BigQuery source missing credentials")
                result = await ask_bigquery(
                    credentials_content=creds,
                    project_id=meta.get("projectId", ""),
                    dataset_id=meta.get("datasetId", ""),
                    tables=meta.get("tables", []),
                    question=alert.question,
                    agent_description=agent.description or "",
                    source_name=source.name,
                    table_infos=meta.get("table_infos"),
                    llm_overrides=llm_overrides,
                    history=[],
                    channel="alert",
                    sql_mode=sql_mode,
                )
            else:
                raise ValueError(f"Unsupported source type: {source.type}")

            answer = result.get("answer", "")
            status = "success"

            # Send email
            alert_type = getattr(alert, "type", "alert") or "alert"
            if alert_type == "report":
                subject, html = build_report_email(alert.name, alert.question, answer, agent.name)
            else:
                subject, html = build_alert_email(alert.name, alert.question, answer, agent.name)
            email_sent = send_email(alert.email, subject, html)

            # Fire webhooks
            event = "report.generated" if alert_type == "report" else "alert.executed"
            webhooks_fired = await dispatch_webhooks(
                db, alert.user_id, event,
                {
                    "alert_id": alert.id,
                    "alert_name": alert.name,
                    "alert_type": alert_type,
                    "question": alert.question,
                    "answer": answer,
                    "agent_id": alert.agent_id,
                    "agent_name": agent.name,
                },
                agent_id=alert.agent_id,
            )

        except Exception as exc:
            error_msg = str(exc)
            logger.exception("Alert %s execution failed: %s", alert.id, exc)

        duration_ms = int((time.monotonic() - start) * 1000)

        # Save execution record
        execution = AlertExecution(
            id=exec_id,
            alert_id=alert.id,
            status=status,
            answer=answer[:10000] if answer else None,
            error_message=error_msg,
            email_sent=email_sent,
            webhooks_fired=webhooks_fired,
            duration_ms=duration_ms,
        )
        db.add(execution)

        # Update alert
        r = await db.execute(select(Alert).where(Alert.id == alert.id))
        alert_row = r.scalar_one_or_none()
        if alert_row:
            alert_row.last_run = datetime.utcnow()
            alert_row.last_status = status
            alert_row.next_run = _compute_next_run(alert_row)

        await db.commit()
        logger.info("Alert %s executed: status=%s, email=%s, webhooks=%d, %dms",
                     alert.id, status, email_sent, webhooks_fired, duration_ms)


async def alert_scheduler_worker() -> None:
    """Background worker that runs forever, checking for due alerts every CHECK_INTERVAL_SECONDS."""
    logger.info("Alert scheduler started (interval=%ds)", CHECK_INTERVAL_SECONDS)
    while True:
        try:
            await _check_and_run_due_alerts()
        except Exception:
            logger.exception("Alert scheduler tick failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


async def _check_and_run_due_alerts() -> None:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        r = await db.execute(
            select(Alert).where(
                Alert.is_active == True,
                Alert.next_run <= now,
            )
        )
        due_alerts = list(r.scalars().all())

    if not due_alerts:
        return

    logger.info("Found %d due alerts", len(due_alerts))
    for alert in due_alerts:
        try:
            await _execute_single_alert(alert)
        except Exception:
            logger.exception("Failed to execute alert %s", alert.id)


async def execute_alert_now(alert_id: str) -> dict:
    """Execute a specific alert immediately (for testing). Returns execution result."""
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(Alert).where(Alert.id == alert_id))
        alert = r.scalar_one_or_none()
        if not alert:
            return {"status": "error", "error": "Alert not found"}

    await _execute_single_alert(alert)

    async with AsyncSessionLocal() as db:
        r = await db.execute(
            select(AlertExecution)
            .where(AlertExecution.alert_id == alert_id)
            .order_by(AlertExecution.created_at.desc())
            .limit(1)
        )
        execution = r.scalar_one_or_none()
        if execution:
            return {
                "status": execution.status,
                "answer": execution.answer,
                "error": execution.error_message,
                "email_sent": execution.email_sent,
                "webhooks_fired": execution.webhooks_fired,
                "duration_ms": execution.duration_ms,
            }
    return {"status": "error", "error": "Execution record not found"}
