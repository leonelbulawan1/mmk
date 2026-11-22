"""Application settings, read from environment variables (or backend/.env)."""
from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env = BASE_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    # Hosted PostgreSQL providers (Neon, Render, Supabase) hand out "postgres://" or "postgresql://"
    # URLs; SQLAlchemy needs the driver name, so those are rewritten to use psycopg 3.
    database_url: str = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://",
                               os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'alaala.db'}"))
    jwt_secret: str = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)
    jwt_ttl_minutes: int = int(os.getenv("JWT_TTL_MINUTES", "480"))
    remember_me_days: int = int(os.getenv("REMEMBER_ME_DAYS", "30"))
    cors_origins: tuple[str, ...] = tuple(
        o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()
    )
    swipl_path: str = os.getenv("SWIPL_PATH", "swipl")
    prolog_timeout_s: float = float(os.getenv("PROLOG_TIMEOUT_S", "10"))
    # LLM: "anthropic" | "openai" | "offline"
    llm_provider: str = os.getenv("LLM_PROVIDER", "offline")
    llm_model: str = os.getenv("LLM_MODEL", "claude-sonnet-5-5")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    llm_max_tool_rounds: int = int(os.getenv("LLM_MAX_TOOL_ROUNDS", "6"))
    timezone: str = os.getenv("APP_TIMEZONE", "Asia/Manila")  # dates of entries and letters follow this zone
    # Email notices to beneficiaries after the death trigger (plain SMTP; leave SMTP_HOST empty to disable).
    app_url: str = os.getenv("APP_URL", "http://localhost:5173")
    # Waiting period between an executor's report of the owner's passing and the death trigger.
    death_report_wait_minutes: int = int(os.getenv("DEATH_REPORT_WAIT_MINUTES", str(14 * 24 * 60)))
    # admin: a report needs an MMK reviewer's approval (then the waiting period runs, during which the owner can
    # cancel and beneficiaries can dispute). waiting_period: the earlier flow, the waiting period alone.
    death_review: str = os.getenv("DEATH_REVIEW", "admin").strip().lower()
    # Accounts that may review reports: their emails, comma-separated. They sign up like any account.
    admin_emails: str = os.getenv("ADMIN_EMAILS", "")
    # Key for encrypting uploaded evidence (Fernet). If empty, a key is derived from JWT_SECRET.
    evidence_key: str = os.getenv("EVIDENCE_KEY", "")
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "MMK <no-reply@localhost>")
    smtp_starttls: bool = os.getenv("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")
    # Alternative to SMTP: send through Brevo's HTTPS API. Use this on hosts that block SMTP ports
    # (most free tiers). The sender is taken from SMTP_FROM and must be verified in Brevo.
    brevo_api_key: str = os.getenv("BREVO_API_KEY", "")
    # Send through the owner's own Gmail with a Google Apps Script web app (see docs/deploy/GMAIL_RELAY.md).
    # Mail then really comes from gmail.com, so Gmail and school inboxes accept it instead of filtering it.
    gmail_relay_url: str = os.getenv("GMAIL_RELAY_URL", "")
    gmail_relay_secret: str = os.getenv("GMAIL_RELAY_SECRET", "")
    # live: email anyone. sandbox: email only addresses on EMAIL_ALLOWLIST (comma list; "@school.edu" = whole domain),
    # so test and demo servers never email real beneficiaries.
    email_mode: str = os.getenv("EMAIL_MODE", "live").strip().lower()
    email_allowlist: str = os.getenv("EMAIL_ALLOWLIST", "")
    # Development only: when email cannot be sent, show the email verification code on screen.
    # Never enable this on a public server - it would let anyone register any address.
    dev_show_verification_code: bool = os.getenv("DEV_SHOW_VERIFICATION_CODE", "false").lower() in ("1", "true", "yes")


settings = Settings()


def today():
    """Today's date in the configured timezone (used for date-based release)."""
    from datetime import datetime, timezone

    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(settings.timezone)).date()
    except Exception:  # unknown zone or no tz database available
        return datetime.now(timezone.utc).date()
