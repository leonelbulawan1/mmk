"""One-time 6-digit codes sent by email: email verification and password reset.

Both use the same rules: only a hash of the code is stored, it expires after 15 minutes, allows
5 wrong attempts, and a new one can be requested once a minute. Each purpose has its own columns,
so a verification code can never be used to reset a password or the other way round.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..config import settings
from ..models import EmailNotice, User
from . import audit, notify

CODE_TTL = timedelta(minutes=15)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5


class VerificationError(ValueError):
    pass


class TooSoon(VerificationError):
    pass


@dataclass(frozen=True)
class Purpose:
    key: str
    prefix: str  # column prefix on User: verify_* or reset_*
    subject: str
    intro: str
    outro: str


VERIFY = Purpose("verify", "verify", "Your MMK verification code: {code}",
                 "Use this code to verify your email and finish creating your MMK account:",
                 "If you did not create an MMK account, you can ignore this email.")
RESET = Purpose("reset", "reset", "Your MMK password reset code: {code}",
                "Use this code to choose a new password for your MMK account:",
                "If you did not ask to reset your password, you can ignore this email; your password stays the same.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(user: User, purpose: Purpose, code: str) -> str:
    return hashlib.sha256(f"{purpose.key}:{user.id}:{code.strip()}".encode()).hexdigest()


def _get(user: User, purpose: Purpose, field: str):
    attr = f"{purpose.prefix}_code_hash" if field == "hash" else f"{purpose.prefix}_{field}"
    return getattr(user, attr)


def _set(user: User, purpose: Purpose, field: str, value) -> None:
    attr = f"{purpose.prefix}_code_hash" if field == "hash" else f"{purpose.prefix}_{field}"
    setattr(user, attr, value)


def can_show_code() -> bool:
    return settings.dev_show_verification_code and not notify.smtp_configured()


def send_code(db: Session, user: User, purpose: Purpose = VERIFY) -> dict:
    """Create a fresh code and email it. Returns what the client may know."""
    sent_at = _get(user, purpose, "sent_at")
    if sent_at and _now() - datetime.fromisoformat(sent_at) < RESEND_AFTER:
        wait = int((RESEND_AFTER - (_now() - datetime.fromisoformat(sent_at))).total_seconds()) + 1
        raise TooSoon(f"Please wait {wait} seconds before asking for another code")
    code = f"{secrets.randbelow(1_000_000):06d}"
    _set(user, purpose, "hash", _hash(user, purpose, code))
    _set(user, purpose, "expires_at", (_now() + CODE_TTL).isoformat())
    _set(user, purpose, "sent_at", _now().isoformat())
    _set(user, purpose, "attempts", 0)
    body = "\n".join([f"Hi {user.display_name.split()[0]},", "", purpose.intro, "", f"    {code}", "",
                      f"The code expires in 15 minutes. {purpose.outro}", "", "MMK"])
    notice = EmailNotice(owner_id=user.owner_id or user.id, beneficiary_id=user.id, to_email=user.email,
                         subject=purpose.subject.format(code=code), body=body, kind=f"{purpose.key}_email",
                         status="queued", error="", attempts=0)
    db.add(notice)
    notify._send(notice)
    if notice.status in ("failed", "retrying"):  # nothing reached the inbox yet: let them try again straight away
        _set(user, purpose, "sent_at", None)
    audit.record(db, user.owner_id or user.id, user, f"auth.{purpose.key}_code_sent", {"status": notice.status},
                 commit=False)
    db.commit()
    out = {"email_sent": notice.status == "sent", "email_configured": notify.smtp_configured(),
           "email_problem": notify.email_problem(notice)}
    if can_show_code():
        out["demo_code"] = code
    return out


def check_code(db: Session, user: User, code: str, purpose: Purpose = VERIFY) -> None:
    """Raise VerificationError unless *code* is the current, unexpired code. Consumes it on success."""
    stored, expires = _get(user, purpose, "hash"), _get(user, purpose, "expires_at")
    if not stored or not expires:
        raise VerificationError("Ask for a new code")
    if _now() > datetime.fromisoformat(expires):
        raise VerificationError("This code has expired. Ask for a new one")
    attempts = _get(user, purpose, "attempts") or 0
    if attempts >= MAX_ATTEMPTS:
        raise VerificationError("Too many wrong codes. Ask for a new one")
    if not hmac.compare_digest(stored, _hash(user, purpose, code)):
        attempts += 1
        _set(user, purpose, "attempts", attempts)
        audit.record(db, user.owner_id or user.id, None, f"auth.{purpose.key}_code_failed", {"attempt": attempts},
                     commit=False)
        db.commit()
        left = MAX_ATTEMPTS - attempts
        raise VerificationError("That code is not correct" + (f" ({left} tries left)" if left else ". Ask for a new one"))
    _set(user, purpose, "hash", None)
    _set(user, purpose, "expires_at", None)
    _set(user, purpose, "attempts", 0)


def verify(db: Session, user: User, code: str) -> None:
    if user.email_verified_at:
        return
    check_code(db, user, code, VERIFY)
    user.email_verified_at = _now().isoformat()
    audit.record(db, user.id, user, "auth.email_verified", {}, commit=False)
    db.commit()
