"""The death trigger, and the executor's report that starts it after a waiting period.

Flow
----
1. The owner names one of their (active, activated) beneficiaries as **executor**.
2. When the owner passes away, the executor **reports** it from their own account (their password).
3. The owner is emailed and sees a banner; the report activates only after the **waiting period**
   (``DEATH_REPORT_WAIT_MINUTES``, default 14 days). If the owner is still alive they sign in and
   press "I'm still here", which cancels it. The executor can also withdraw the report.
4. When the waiting period ends without a cancellation, the death trigger activates exactly as if
   the owner had pressed it: vault sealed, policy frozen, beneficiaries emailed.

With ``DEATH_REVIEW=admin`` (the default) a report is first checked by an MMK reviewer (an account listed in
``ADMIN_EMAILS``), who looks at the uploaded evidence:

    reported ──review──▶ under_review ──approve──▶ verified ──waiting period, no dispute──▶ activated
       │  ╲                  │  ╲reject▶ rejected        │
       │   ╲dispute▶ disputed ◀┘◀───────── dispute ───────┘      (disputed ──resolve──▶ under_review)
       └─ owner signs in: cancelled · executor: withdrawn (any time before activation)

Only ``verified`` (or the older ``pending``) reports can ever activate. Every change is a conditional update
on the current status, so two reviewers, or a reviewer and the background job, can never both act on one report.
AI plays no part in any of this.

There is no background job requirement: due reports are processed on application start-up, by a
periodic task on the server, and lazily on every authenticated request.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DeathEvidence, DeathReport, EmailNotice, User, now_iso
from . import audit, notify, policy_service
from .vault_service import owner_from_row


def _now() -> datetime:
    return datetime.now(timezone.utc)


def activate(db: Session, owner: User, actor: User | None, via: str) -> list[EmailNotice]:
    """Seal the vault, freeze the policy and notify beneficiaries. Irreversible."""
    if owner.death_triggered_at:
        raise PermissionError("The death trigger has already been activated")
    when = owner_from_row(owner).activate_death_trigger(_now())
    owner.death_triggered_at = when.isoformat()
    protocol = policy_service.current_protocol(db, owner)
    audit.record(db, owner.id, actor, "death.trigger",
                 {"at": owner.death_triggered_at, "via": via, "frozen_policy_version": protocol.version}, commit=False)
    db.commit()
    try:
        return notify.notify_beneficiaries_after_death(db, owner)
    except Exception as exc:  # the trigger has succeeded; report the email problem separately
        db.rollback()
        audit.record(db, owner.id, None, "notify.error", {"error": str(exc)[:200]})
        return []


OPEN = ("pending", "reported", "under_review", "verified", "disputed")  # a report that is still running
CAN_ACTIVATE = ("pending", "verified")
NOT_SET = "9999-12-31T00:00:00+00:00"  # activates_at of a report that no reviewer has approved yet


class ReviewError(ValueError):
    """The report is not in a state that allows this step (someone else acted first, or the step is wrong)."""


def review_required() -> bool:
    return settings.death_review == "admin"


def reviewer_emails() -> set[str]:
    return {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}


def is_reviewer(user: User | None) -> bool:
    return bool(user and user.role == "owner" and user.active and user.email_verified_at
                and user.email.lower() in reviewer_emails())


def pending_report(db: Session, owner_id: int) -> DeathReport | None:
    return db.scalars(select(DeathReport).where(DeathReport.owner_id == owner_id, DeathReport.status.in_(OPEN))
                      .order_by(DeathReport.id.desc()).limit(1)).first()


def _move(db: Session, rep: DeathReport, allowed: tuple[str, ...], to: str, actor: User | None, action: str,
          detail: dict | None = None, **values) -> DeathReport:
    """Change a report's status only if it is still in one of `allowed` (one atomic update)."""
    from sqlalchemy import update

    done = db.execute(update(DeathReport).where(DeathReport.id == rep.id, DeathReport.status.in_(allowed))
                      .values(status=to, **values)).rowcount
    if not done:
        db.rollback()
        db.refresh(rep)
        raise ReviewError(f"This report is {rep.status.replace('_', ' ')}, so that step is not possible now")
    audit.record(db, rep.owner_id, actor, action, {"report": rep.id, "to": to, **(detail or {})}, commit=False)
    db.commit()
    db.refresh(rep)
    return rep


def report(db: Session, executor: User) -> DeathReport:
    owner = db.get(User, executor.owner_id)
    if owner is None or owner.executor_id != executor.id:
        raise PermissionError("Only the executor chosen by the diary owner can report their passing")
    if owner.death_triggered_at:
        raise ValueError("This diary has already been sealed")
    if pending_report(db, owner.id):
        raise ValueError("A report is already waiting")
    start = _now()
    reviewed = review_required()
    rep = DeathReport(owner_id=owner.id, reported_by=executor.id, reported_at=start.isoformat(),
                      activates_at=NOT_SET if reviewed
                      else (start + timedelta(minutes=settings.death_report_wait_minutes)).isoformat(),
                      status="reported" if reviewed else "pending")
    db.add(rep)
    db.flush()
    audit.record(db, owner.id, executor, "death.reported", {"report": rep.id, "activates_at": rep.activates_at},
                 commit=False)
    notify.notify_owner_of_report(db, owner, executor, rep)
    if reviewed:
        notify.notify_reviewers(db, owner, rep)
    db.commit()
    return rep


def _close(db: Session, rep: DeathReport, status: str, actor: User, action: str) -> DeathReport:
    rep.status, rep.closed_at = status, now_iso()
    audit.record(db, rep.owner_id, actor, action, {"report": rep.id}, commit=False)
    db.commit()
    return rep


def cancel_by_owner(db: Session, owner: User) -> DeathReport:
    rep = pending_report(db, owner.id)
    if rep is None:
        raise LookupError("There is no report to cancel")
    return _close(db, rep, "cancelled", owner, "death.report_cancelled")


def withdraw_by_executor(db: Session, executor: User) -> DeathReport:
    rep = pending_report(db, executor.owner_id)
    if rep is None or rep.reported_by != executor.id:
        raise LookupError("You have no report waiting")
    return _close(db, rep, "withdrawn", executor, "death.report_withdrawn")


# ---- review (DEATH_REVIEW=admin) --------------------------------------------------------------
def _check_reviewer(reviewer: User, rep: DeathReport) -> None:
    if not is_reviewer(reviewer):
        raise PermissionError("Only an MMK reviewer can do this")
    if reviewer.id == rep.owner_id or reviewer.id == rep.reported_by:
        raise PermissionError("A reviewer cannot decide on a report that concerns their own account")


def start_review(db: Session, reviewer: User, rep: DeathReport) -> DeathReport:
    _check_reviewer(reviewer, rep)
    return _move(db, rep, ("reported", "disputed"), "under_review", reviewer, "death.review_started",
                 reviewer_id=reviewer.id)


def approve(db: Session, reviewer: User, rep: DeathReport, note: str) -> DeathReport:
    """The evidence is convincing: start the waiting period. The owner can still cancel; beneficiaries can dispute."""
    _check_reviewer(reviewer, rep)
    if not db.scalars(select(DeathEvidence.id).where(DeathEvidence.report_id == rep.id)).first():
        raise ReviewError("There is no evidence to review yet. Ask the executor to upload a document first")
    when = (_now() + timedelta(minutes=settings.death_report_wait_minutes)).isoformat()
    rep = _move(db, rep, ("under_review",), "verified", reviewer, "death.report_verified", {"activates_at": when},
                reviewer_id=reviewer.id, reviewed_at=now_iso(), decision_note=note.strip()[:2000], activates_at=when)
    owner = db.get(User, rep.owner_id)
    notify.notify_owner_of_verification(db, owner, rep)
    db.commit()
    return rep


def reject(db: Session, reviewer: User, rep: DeathReport, note: str) -> DeathReport:
    _check_reviewer(reviewer, rep)
    if not note.strip():
        raise ReviewError("Say why the report is rejected")
    return _move(db, rep, ("reported", "under_review", "disputed"), "rejected", reviewer, "death.report_rejected",
                 reviewer_id=reviewer.id, reviewed_at=now_iso(), decision_note=note.strip()[:2000], closed_at=now_iso())


def dispute(db: Session, beneficiary: User, reason: str) -> DeathReport:
    """Any active beneficiary of the owner can stop a report from activating until a reviewer looks again."""
    rep = pending_report(db, beneficiary.owner_id)
    if rep is None or rep.status == "pending":
        raise LookupError("There is no report that can be disputed")
    if not reason.strip():
        raise ReviewError("Say why you dispute the report")
    rep = _move(db, rep, ("reported", "under_review", "verified"), "disputed", beneficiary, "death.report_disputed",
                disputed_by=beneficiary.id, dispute_reason=reason.strip()[:2000], activates_at=NOT_SET)
    notify.notify_reviewers(db, db.get(User, rep.owner_id), rep, disputed=True)
    db.commit()
    return rep


# ---- evidence ----------------------------------------------------------------------------------
MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
MAX_EVIDENCE_FILES = 5
_SIGNATURES = {b"%PDF-": "application/pdf", b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}


def _fernet():
    import base64
    import hashlib

    from cryptography.fernet import Fernet

    key = settings.evidence_key or base64.urlsafe_b64encode(
        hashlib.sha256(("mmk-evidence:" + settings.jwt_secret).encode()).digest()).decode()
    return Fernet(key)


def add_evidence(db: Session, executor: User, filename: str, content: bytes) -> DeathEvidence:
    import hashlib

    rep = pending_report(db, executor.owner_id)
    if rep is None or rep.reported_by != executor.id or rep.status not in ("reported", "under_review", "disputed"):
        raise LookupError("You can add documents only to your own report while it is being reviewed")
    if not content or len(content) > MAX_EVIDENCE_BYTES:
        raise ReviewError("The file must be smaller than 5 MB")
    kind = next((t for sig, t in _SIGNATURES.items() if content.startswith(sig)), None)
    if kind is None:  # judged by the file's bytes, not its name
        raise ReviewError("Only PDF, JPEG or PNG files can be uploaded")
    count = len(db.scalars(select(DeathEvidence.id).where(DeathEvidence.report_id == rep.id)).all())
    if count >= MAX_EVIDENCE_FILES:
        raise ReviewError(f"At most {MAX_EVIDENCE_FILES} documents can be added to one report")
    ev = DeathEvidence(report_id=rep.id, uploaded_by=executor.id, filename=(filename or "document")[-200:],
                       content_type=kind, size=len(content), sha256=hashlib.sha256(content).hexdigest(),
                       data=_fernet().encrypt(content))
    db.add(ev)
    db.flush()
    audit.record(db, rep.owner_id, executor, "death.evidence_added",
                 {"report": rep.id, "file": ev.filename, "sha256": ev.sha256, "bytes": ev.size}, commit=False)
    db.commit()
    return ev


def read_evidence(db: Session, reviewer: User, evidence_id: int) -> tuple[DeathEvidence, bytes]:
    ev = db.get(DeathEvidence, evidence_id)
    if ev is None:
        raise LookupError("Not found")
    rep = db.get(DeathReport, ev.report_id)
    _check_reviewer(reviewer, rep)
    audit.record(db, rep.owner_id, reviewer, "death.evidence_viewed", {"report": rep.id, "evidence": ev.id})
    return ev, _fernet().decrypt(ev.data)


def evidence_list(db: Session, rep: DeathReport) -> list[dict]:
    rows = db.scalars(select(DeathEvidence).where(DeathEvidence.report_id == rep.id).order_by(DeathEvidence.id)).all()
    return [{"id": e.id, "filename": e.filename, "content_type": e.content_type, "size": e.size, "sha256": e.sha256,
             "created_at": e.created_at} for e in rows]


_LAST_REQUEST_CHECK = [0.0]


def process_due_light(db: Session, min_interval_seconds: float = 20) -> int:
    """The check run inside ordinary requests: only due executor reports, at most every few seconds.
    The heavier letter sweep runs in the background loop and on /api/health instead."""
    import time
    now = time.monotonic()
    if min_interval_seconds and now - _LAST_REQUEST_CHECK[0] < min_interval_seconds:
        return 0
    _LAST_REQUEST_CHECK[0] = now
    return process_due(db, letters=False)


def process_due(db: Session, letters: bool = True) -> int:
    """Activate every pending report whose waiting period is over. Returns how many activated."""
    now = _now().isoformat()
    from sqlalchemy import update

    due = db.scalars(select(DeathReport).where(DeathReport.status.in_(CAN_ACTIVATE),
                                               DeathReport.activates_at <= now)).all()
    count = 0
    for rep in due:
        # Claim it: only one runner can move it to "activated", and a dispute or cancel that came first wins.
        claimed = db.execute(update(DeathReport).where(DeathReport.id == rep.id, DeathReport.status.in_(CAN_ACTIVATE),
                                                       DeathReport.activates_at <= now)
                             .values(status="activated", closed_at=now_iso())).rowcount
        db.commit()
        if not claimed:
            continue
        owner = db.get(User, rep.owner_id)
        if owner and not owner.death_triggered_at:
            activate(db, owner, db.get(User, rep.reported_by), via="executor_report")
            count += 1
    if not letters:
        return count
    try:  # letters whose own date has now come: tell their recipient (throttled inside)
        notify.notify_released_letters(db)
    except Exception as exc:  # never block a request because of an email problem
        db.rollback()
        audit.record(db, None, None, "notify.error", {"error": str(exc)[:200]})
    return count


def report_out(db: Session, rep: DeathReport | None) -> dict | None:
    if rep is None:
        return None
    by = db.get(User, rep.reported_by)
    return {"id": rep.id, "status": rep.status, "reported_at": rep.reported_at,
            "activates_at": None if rep.activates_at == NOT_SET else rep.activates_at,
            "reported_by": by.display_name if by else "", "wait_minutes": settings.death_report_wait_minutes,
            "review_required": rep.status != "pending", "decision_note": rep.decision_note,
            "dispute_reason": rep.dispute_reason, "evidence": evidence_list(db, rep)}
