"""Email notices to beneficiaries when the death trigger is activated.

Privacy rule: an email NEVER contains diary content (no entry text, summaries, topics or letter
text). It only says that something is available and links to the sign-in page, where every access
decision is still made by the Prolog rules. Email is not a secure channel, so the content stays
behind authentication.

Sending uses Brevo's HTTPS API when ``BREVO_API_KEY`` is set (works on hosts that block SMTP ports),
otherwise plain SMTP (``SMTP_*`` settings). If neither is configured, or the app runs in the
browser edition (no network), notices are kept in the outbox with status ``not_configured`` and can
be retried from Settings once email is set up.
"""
from __future__ import annotations

import smtplib
import sys
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings, today
from ..models import EmailNotice, User, now_iso
from . import audit, policy_service, vault_service


def smtp_configured() -> bool:
    """True when email can be sent, by SMTP or by the Brevo API."""
    return bool(settings.smtp_host or settings.brevo_api_key) and sys.platform != "emscripten"


def _send_brevo(notice: EmailNotice) -> None:
    import httpx
    from email.utils import parseaddr

    name, address = parseaddr(settings.smtp_from)
    resp = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
        json={"sender": {"name": name or "MMK", "email": address},
              "to": [{"email": notice.to_email}],
              "subject": notice.subject, "textContent": notice.body},
        timeout=20,
    )
    if resp.status_code >= 300:
        raise OSError(f"Brevo API {resp.status_code}: {resp.text[:200]}")


def activation_link(email: str, code: str) -> str:
    """One-click activation: the page opens with the email and invite code already filled in."""
    from urllib.parse import urlencode

    return f"{settings.app_url.rstrip('/')}/activate?{urlencode({'email': email, 'code': code})}"


def _compose(owner: User, ben: User, letters: int, entries: int, invite_code: str | None) -> tuple[str, str]:
    first = ben.display_name.split()[0] if ben.display_name else "there"
    parts = []
    if letters:
        parts.append(f"{letters} letter{'s' if letters != 1 else ''} written for you")
    if entries:
        parts.append(f"{entries} diary entr{'ies' if entries != 1 else 'y'} shared with you")
    available = " and ".join(parts)
    url = settings.app_url.rstrip("/")
    lines = [
        f"Dear {first},",
        "",
        f"{owner.display_name} kept a private diary on MMK and named you as one of the people who may",
        "remember them through it. Their diary has now been sealed, and the wishes they left for sharing",
        "are in effect.",
        "",
        f"Waiting for you: {available}.",
        "",
    ]
    if invite_code:
        lines += [
            "You have not activated your MMK account yet. Open this link and choose a password:",
            "",
            f"    {activation_link(ben.email, invite_code)}",
            "",
            f"If the link does not open, go to {url}/activate and enter this one-time code:",
            "",
            f"    {invite_code}",
        ]
    else:
        lines += ["Sign in with your MMK account to read them:", "", f"    {url}/login"]
    lines += [
        "",
        "For privacy, no part of the diary is included in this email.",
        "",
        "Please note: letters and wishes on MMK are personal messages, not a legal will. They have no legal",
        "effect on property or inheritance, and MMK does not give legal advice.",
        "",
        "With care,",
        "MMK",
    ]
    subject = f"{owner.display_name} left something for you on MMK"
    return subject, "\n".join(lines)


def _send(notice: EmailNotice) -> None:
    notice.attempts = (notice.attempts or 0) + 1
    if not smtp_configured():
        notice.status = "not_configured"
        notice.error = "Email sending is not set up (set BREVO_API_KEY or SMTP_HOST)."
        return
    if settings.brevo_api_key:
        try:
            _send_brevo(notice)
            notice.status, notice.error, notice.sent_at = "sent", "", now_iso()
        except Exception as exc:  # network errors, API errors
            notice.status, notice.error = "failed", str(exc)[:300]
        return
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = notice.to_email
    msg["Subject"] = notice.subject
    msg.set_content(notice.body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        notice.status, notice.error, notice.sent_at = "sent", "", now_iso()
    except (smtplib.SMTPException, OSError) as exc:
        notice.status, notice.error = "failed", str(exc)[:300]


def notify_beneficiaries_after_death(db: Session, owner: User) -> list[EmailNotice]:
    """Queue and send one notice per active beneficiary who has something available now."""
    from ..routers.auth import hash_invite, new_code

    engine = policy_service.engine_for(db, owner)
    kinds = {int(e.id): e.kind for e in vault_service.load_vault(db, owner).entries}
    notices: list[EmailNotice] = []
    for ben in vault_service.beneficiary_rows(db, owner):  # active beneficiaries only
        decisions = engine.decide_all(ben.handle, today())
        letters = sum(1 for d in decisions.values() if d.level != "none" and kinds.get(d.entry_id) == "letter")
        entries = sum(1 for d in decisions.values() if d.level != "none" and kinds.get(d.entry_id) == "text")
        if not letters and not entries:
            continue  # nothing to tell them about
        invite = None
        if ben.password_hash is None:  # never activated: include a fresh one-time invite code
            invite = new_code()
            ben.invite_code_hash = hash_invite(invite)
        subject, body = _compose(owner, ben, letters, entries, invite)
        notice = EmailNotice(owner_id=owner.id, beneficiary_id=ben.id, to_email=ben.email, subject=subject, body=body,
                             kind="death_notice", status="queued", error="", attempts=0)
        db.add(notice)
        _send(notice)
        db.flush()
        audit.record(db, owner.id, None, f"notify.{notice.status}",
                     {"to": ben.handle, "letters": letters, "entries": entries}, commit=False)
        notices.append(notice)
    db.commit()
    return notices


def notify_owner_of_report(db: Session, owner: User, executor: User, rep) -> EmailNotice:
    """Tell the owner that their executor reported their passing, and how to cancel it."""
    from datetime import datetime

    when = datetime.fromisoformat(rep.activates_at).strftime("%B %d, %Y at %H:%M UTC")
    url = settings.app_url.rstrip("/")
    body = "\n".join([
        f"Dear {owner.display_name.split()[0]},",
        "",
        f"{executor.display_name}, the executor you chose on MMK, has reported that you have passed away.",
        "",
        f"If this is not true, sign in before {when} and press \"I'm still here\" to cancel it:",
        "",
        f"    {url}/login",
        "",
        "If nothing is cancelled by then, your vault will be sealed, your legacy policy frozen, and your",
        "beneficiaries notified, as you arranged.",
        "",
        "MMK",
    ])
    notice = EmailNotice(owner_id=owner.id, beneficiary_id=owner.id, to_email=owner.email,
                         subject="Someone reported your passing on MMK", body=body, kind="report_to_owner",
                         status="queued", error="", attempts=0)
    db.add(notice)
    _send(notice)
    db.flush()
    audit.record(db, owner.id, None, f"notify.owner.{notice.status}", {"kind": "report_to_owner"}, commit=False)
    return notice


def retry(db: Session, owner: User, notice_id: int) -> EmailNotice:
    notice = db.get(EmailNotice, notice_id)
    if notice is None or notice.owner_id != owner.id:
        raise KeyError(notice_id)
    if notice.status != "sent":
        _send(notice)
        audit.record(db, owner.id, owner, f"notify.retry.{notice.status}", {"notice": notice.id}, commit=False)
        db.commit()
    return notice


def list_notices(db: Session, owner: User) -> list[dict]:
    rows = db.scalars(select(EmailNotice).where(EmailNotice.owner_id == owner.id, EmailNotice.kind == "death_notice")
                      .order_by(EmailNotice.id)).all()
    names = {u.id: u.display_name for u in vault_service.beneficiary_rows(db, owner, active_only=False)}
    return [{"id": n.id, "to_email": n.to_email, "to_name": names.get(n.beneficiary_id, ""), "subject": n.subject,
             "body": n.body, "status": n.status, "error": n.error, "attempts": n.attempts,
             "created_at": n.created_at, "sent_at": n.sent_at} for n in rows]
