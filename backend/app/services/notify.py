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

import html
import re
import smtplib
import sys
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings, today
from ..models import EmailNotice, User, now_iso
from . import audit, policy_service, vault_service


def smtp_configured() -> bool:
    """True when email can be sent: by the Gmail relay, the Brevo API or SMTP."""
    return (bool(settings.gmail_relay_url or settings.smtp_host or settings.brevo_api_key)
            and sys.platform != "emscripten")


_URL = re.compile(r"(https?://[^\s<]+)")


def _html(text: str) -> str:
    """The same message as simple HTML (clickable links). Inboxes trust mail with both parts more."""
    safe = html.escape(text)
    safe = _URL.sub(lambda m: f'<a href="{m.group(1)}">{m.group(1)}</a>', safe)
    return ('<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2a44">'
            + safe.replace("\n", "<br>") + "</div>")


def _send_gmail_relay(notice: EmailNotice) -> str | None:
    """Send through the owner's Gmail (Google Apps Script web app). Returns an id or raises."""
    import httpx
    from email.utils import parseaddr

    name, _ = parseaddr(settings.smtp_from)
    resp = httpx.post(settings.gmail_relay_url, follow_redirects=True, timeout=30,
                      json={"secret": settings.gmail_relay_secret, "to": notice.to_email, "subject": notice.subject,
                            "body": notice.body, "html": _html(notice.body), "name": name or "MMK"})
    try:
        data = resp.json()
    except ValueError:
        raise OSError(f"Gmail relay {resp.status_code}: unexpected answer (is the web app deployed for 'Anyone'?)")
    if not data.get("ok"):
        raise OSError(f"Gmail relay: {data.get('error') or 'refused'}")
    return None


def _send_brevo(notice: EmailNotice) -> None:
    import httpx
    from email.utils import parseaddr

    name, address = parseaddr(settings.smtp_from)
    resp = httpx.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
        json={"sender": {"name": name or "MMK", "email": address},
              "to": [{"email": notice.to_email}],
              "subject": notice.subject, "textContent": notice.body, "htmlContent": _html(notice.body)},
        timeout=20,
    )
    if resp.status_code >= 300:
        raise OSError(f"Brevo API {resp.status_code}: {resp.text[:200]}")
    try:
        import json as _json
        return (_json.loads(resp.text or "{}") or {}).get("messageId")
    except (ValueError, AttributeError):
        return None


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
    if settings.gmail_relay_url:
        try:
            _send_gmail_relay(notice)
            notice.status, notice.error, notice.sent_at = "sent", "", now_iso()
        except Exception as exc:
            notice.status, notice.error = "failed", str(exc)[:300]
            print(f"[email] could not send {notice.kind} to {notice.to_email}: {notice.error}", file=sys.stderr, flush=True)
        return
    if settings.brevo_api_key:
        try:
            notice.provider_id = _send_brevo(notice)
            notice.status, notice.error, notice.sent_at = "sent", "", now_iso()
        except Exception as exc:  # network errors, API errors
            notice.status, notice.error = "failed", str(exc)[:300]
            print(f"[email] could not send {notice.kind} to {notice.to_email}: {notice.error}", file=sys.stderr, flush=True)
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
        print(f"[email] could not send {notice.kind} to {notice.to_email}: {notice.error}", file=sys.stderr, flush=True)


def email_problem(notice: EmailNotice) -> str:
    """A plain explanation of why an email was not sent, safe to show the person who asked for it."""
    if notice.status == "sent":
        return ""
    if notice.status == "not_configured":
        return "Email sending is not set up on this server yet."
    err = (notice.error or "").lower()
    if "unrecognised ip" in err or "unrecognized ip" in err or "authorised ip" in err or "authorized ip" in err:
        return ("The email service blocked the server's address. The MMK admin must turn off "
                "\"Authorised IPs\" blocking in Brevo (Security settings).")
    if "401" in err or "key not found" in err or "unauthorized" in err:
        return "The email service rejected the server's API key. The MMK admin must check BREVO_API_KEY."
    if "sender" in err and ("valid" in err or "verif" in err):
        return "The sender address is not verified in Brevo. The MMK admin must verify it."
    if "not yet activated" in err or "not activated" in err or "suspended" in err or "permission_denied" in err:
        return "The email service account is not active yet. The MMK admin must check the Brevo account."
    if "gmail relay" in err and ("secret" in err or "unexpected answer" in err):
        return "The Gmail sender is not set up correctly. The MMK admin must check GMAIL_RELAY_URL and GMAIL_RELAY_SECRET."
    if "limit" in err or "quota" in err or "too many times" in err or "429" in err or "credits" in err:
        return "Today's email limit has been reached. Try again later."
    if "timed out" in err or "timeout" in err or "connect" in err:
        return "The email service could not be reached. Try again in a minute."
    return "The email service did not accept the message. Try again in a minute."


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
    mark_letters_in_death_notice(db, owner)
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


# ---- invitations ----------------------------------------------------------------------------
def _compose_invitation(owner: User, ben: User, code: str) -> tuple[str, str]:
    first = ben.display_name.split()[0] if ben.display_name else "there"
    url = settings.app_url.rstrip("/")
    lines = [
        f"Hi {first},",
        "",
        f"{owner.display_name} added you on MMK, a private diary, as one of the people who may remember them.",
        "",
        "Open this link and choose a password to activate your account:",
        "",
        f"    {activation_link(ben.email, code)}",
        "",
        f"If the link does not open, go to {url}/activate and enter this one-time code:",
        "",
        f"    {code}",
        "",
        f"Nothing in {owner.display_name.split()[0]}'s diary is shared with you while they are alive.",
        "",
        "MMK",
    ]
    return f"{owner.display_name} invited you to MMK", "\n".join(lines)


def send_invitation(db: Session, owner: User, ben: User, code: str) -> EmailNotice:
    """Email the activation link and one-time code to a new beneficiary (or a fresh one when re-sent)."""
    subject, body = _compose_invitation(owner, ben, code)
    notice = EmailNotice(owner_id=owner.id, beneficiary_id=ben.id, to_email=ben.email, subject=subject, body=body,
                         kind="invitation", status="queued", error="", attempts=0)
    db.add(notice)
    _send(notice)
    db.flush()
    audit.record(db, owner.id, owner, f"invite.{notice.status}", {"to": ben.handle}, commit=False)
    db.commit()
    return notice


# ---- letters, once they are released ---------------------------------------------------------
def _compose_letter_released(owner: User, ben: User, title: str, invite_code: str | None) -> tuple[str, str]:
    first = ben.display_name.split()[0] if ben.display_name else "there"
    url = settings.app_url.rstrip("/")
    lines = [f"Dear {first},", "",
             f"A letter {owner.display_name} wrote for you, \"{title}\", is now open for you on MMK.", ""]
    if invite_code:
        lines += ["Activate your account to read it:", "", f"    {activation_link(ben.email, invite_code)}", "",
                  f"Or go to {url}/activate and enter this one-time code:", "", f"    {invite_code}"]
    else:
        lines += ["Sign in to read it:", "", f"    {url}/login"]
    lines += ["", "For privacy, the letter itself is not included in this email.", "",
              "Letters on MMK are personal messages, not a legal will.", "", "With care,", "MMK"]
    return f"A letter from {owner.display_name} is waiting for you", "\n".join(lines)


def _released_letters(db: Session, owner: User, engine, ben: User, vault) -> list:
    decisions = engine.decide_all(ben.handle, today())
    return [e for e in vault.entries if e.kind == "letter" and e.recipient_handle == ben.handle
            and decisions.get(int(e.id)) and decisions[int(e.id)].level == "verbatim"]


def _letters_already_told(db: Session, owner: User) -> set[tuple[int, int]]:
    rows = db.scalars(select(EmailNotice).where(EmailNotice.owner_id == owner.id,
                                                EmailNotice.kind.in_(("letter_released", "letter_in_death_notice")))).all()
    return {(r.beneficiary_id, r.entry_id) for r in rows if r.entry_id is not None}


def mark_letters_in_death_notice(db: Session, owner: User) -> None:
    """Letters already counted in the death notice do not get a second email."""
    engine = policy_service.engine_for(db, owner)
    vault = vault_service.load_vault(db, owner)
    told = _letters_already_told(db, owner)
    for ben in vault_service.beneficiary_rows(db, owner):
        for e in _released_letters(db, owner, engine, ben, vault):
            if (ben.id, int(e.id)) not in told:
                db.add(EmailNotice(owner_id=owner.id, beneficiary_id=ben.id, to_email=ben.email, entry_id=int(e.id),
                                   subject="(included in the death notice)", body="", kind="letter_in_death_notice",
                                   status="covered", error="", attempts=0))
    db.commit()


_LAST_LETTER_SWEEP = [0.0]


def notify_released_letters(db: Session, min_interval_seconds: int = 600) -> int:
    """Email each recipient once when one of their letters opens: on its own date (dated letters, even while
    the owner is alive) or after the death trigger. Runs at most every few minutes; decisions come from Prolog.
    Returns how many emails were queued."""
    import time
    now = time.monotonic()
    if min_interval_seconds and now - _LAST_LETTER_SWEEP[0] < min_interval_seconds:
        return 0
    _LAST_LETTER_SWEEP[0] = now
    sent = 0
    for owner in db.scalars(select(User).where(User.role == "owner")).all():
        try:
            sent += notify_owner_letters(db, owner)
        except Exception as exc:  # one owner's problem (e.g. a tampered vault) must not stop the others
            db.rollback()
            print(f"[letters] skipped owner {owner.id}: {exc}", file=sys.stderr, flush=True)
    return sent


def notify_owner_letters(db: Session, owner: User) -> int:
    """Email each of this owner's recipients once for every letter of theirs that is open today."""
    from ..routers.auth import hash_invite, new_code
    from .integrity import ensure_intact

    vault = vault_service.load_vault(db, owner)
    if not any(e.kind == "letter" for e in vault.entries):
        return 0
    ensure_intact(db, owner, vault)  # never release from a tampered vault
    engine = policy_service.engine_for(db, owner)
    told = _letters_already_told(db, owner)
    sent = 0
    for ben in vault_service.beneficiary_rows(db, owner):
        for e in _released_letters(db, owner, engine, ben, vault):
            if (ben.id, int(e.id)) in told:
                continue
            invite = None
            if ben.password_hash is None:
                invite = new_code()
                ben.invite_code_hash = hash_invite(invite)
            subject, body = _compose_letter_released(owner, ben, e.title or "Untitled letter", invite)
            notice = EmailNotice(owner_id=owner.id, beneficiary_id=ben.id, to_email=ben.email, subject=subject,
                                 body=body, kind="letter_released", status="queued", error="", attempts=0,
                                 entry_id=int(e.id))
            db.add(notice)
            _send(notice)
            db.flush()
            audit.record(db, owner.id, None, f"notify.letter.{notice.status}", {"to": ben.handle,
                         "entry": int(e.id)}, commit=False)
            sent += 1
    db.commit()
    return sent


# ---- delivery: did an invitation bounce? -----------------------------------------------------
_LAST_DELIVERY_CHECK: dict[int, float] = {}


def refresh_delivery(db: Session, notice: EmailNotice | None, min_interval_seconds: int = 15) -> EmailNotice | None:
    """Ask the email service whether a sent message was delivered or bounced (e.g. no such Gmail user)."""
    import time
    from .email_check import delivery_status

    if notice is None or notice.status != "sent" or not notice.provider_id or not settings.brevo_api_key:
        return notice
    now = time.monotonic()
    if now - _LAST_DELIVERY_CHECK.get(notice.id, 0.0) < min_interval_seconds:
        return notice
    _LAST_DELIVERY_CHECK[notice.id] = now
    try:
        status, reason = delivery_status(settings.brevo_api_key, notice.provider_id)
    except Exception:
        return notice
    if status:
        notice.status = status
        notice.error = reason if status == "bounced" else ""
        db.commit()
    return notice


def latest_invitation(db: Session, ben: User) -> EmailNotice | None:
    return db.scalars(select(EmailNotice).where(EmailNotice.beneficiary_id == ben.id, EmailNotice.kind == "invitation")
                      .order_by(EmailNotice.id.desc())).first()
