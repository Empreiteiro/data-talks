"""Email service for sending alert notifications and scheduled reports via SMTP."""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings

logger = logging.getLogger(__name__)


def is_smtp_configured() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_from_email)


def send_email(to: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send an email via SMTP. Returns True on success."""
    settings = get_settings()
    if not is_smtp_configured():
        logger.warning("SMTP not configured — skipping email to %s", to)
        return False

    msg = MIMEMultipart("alternative")
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    msg["To"] = to
    msg["Subject"] = subject

    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if settings.smtp_use_tls:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)
            server.starttls()
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30)

        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)

        server.sendmail(settings.smtp_from_email, [to], msg.as_string())
        server.quit()
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


def build_alert_email(alert_name: str, question: str, answer: str, agent_name: str = "") -> tuple[str, str]:
    """Build subject and HTML body for an alert execution email."""
    subject = f"[Data Talks] Alert: {alert_name}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0f172a; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Data Talks - Alert Result</h2>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <p style="color: #64748b; margin: 0 0 8px;">Alert: <strong style="color: #0f172a;">{alert_name}</strong></p>
        {f'<p style="color: #64748b; margin: 0 0 8px;">Agent: <strong style="color: #0f172a;">{agent_name}</strong></p>' if agent_name else ''}
        <p style="color: #64748b; margin: 0 0 16px;">Question: <em>{question}</em></p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
        <div style="line-height: 1.6; color: #1e293b;">
          {answer}
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">Sent automatically by Data Talks Alert System</p>
      </div>
    </div>
    """
    return subject, html


def build_report_email(alert_name: str, question: str, answer: str, agent_name: str = "") -> tuple[str, str]:
    """Build subject and HTML body for a scheduled report email."""
    subject = f"[Data Talks] Report: {alert_name}"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
      <div style="background: #1e40af; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Data Talks - Scheduled Report</h2>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <p style="color: #64748b; margin: 0 0 8px;">Report: <strong style="color: #0f172a;">{alert_name}</strong></p>
        {f'<p style="color: #64748b; margin: 0 0 8px;">Agent: <strong style="color: #0f172a;">{agent_name}</strong></p>' if agent_name else ''}
        <p style="color: #64748b; margin: 0 0 16px;">Query: <em>{question}</em></p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
        <div style="line-height: 1.6; color: #1e293b;">
          {answer}
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">Sent automatically by Data Talks Scheduled Reports</p>
      </div>
    </div>
    """
    return subject, html
