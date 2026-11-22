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

There is no background job requirement: due reports are processed on application start-up, by a
periodic task on the server, and lazily on every authenticated request.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DeathReport, EmailNotice, User, now_iso
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


def pending_report(db: Session, owner_id: int) -> DeathReport | None:
    return db.scalars(select(DeathReport).where(DeathReport.owner_id == owner_id, DeathReport.status == "pending")
                      .order_by(DeathReport.id.desc()).limit(1)).first()


def report(db: Session, executor: User) -> DeathReport:
    owner = db.get(User, executor.owner_id)
    if owner is None or owner.executor_id != executor.id:
        raise PermissionError("Only the executor chosen by the diary owner can report their passing")
    if owner.death_triggered_at:
        raise ValueError("This diary has already been sealed")
    if pending_report(db, owner.id):
        raise ValueError("A report is already waiting")
    start = _now()
    rep = DeathReport(owner_id=owner.id, reported_by=executor.id, reported_at=start.isoformat(),
                      activates_at=(start + timedelta(minutes=settings.death_report_wait_minutes)).isoformat(),
                      status="pending")
    db.add(rep)
    db.flush()
    audit.record(db, owner.id, executor, "death.reported", {"report": rep.id, "activates_at": rep.activates_at},
                 commit=False)
    notify.notify_owner_of_report(db, owner, executor, rep)
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


def process_due(db: Session) -> int:
    """Activate every pending report whose waiting period is over. Returns how many activated."""
    now = _now().isoformat()
    due = db.scalars(select(DeathReport).where(DeathReport.status == "pending", DeathReport.activates_at <= now)).all()
    count = 0
    for rep in due:
        owner = db.get(User, rep.owner_id)
        rep.status, rep.closed_at = "activated", now_iso()
        db.commit()
        if owner and not owner.death_triggered_at:
            activate(db, owner, db.get(User, rep.reported_by), via="executor_report")
            count += 1
    return count


def report_out(db: Session, rep: DeathReport | None) -> dict | None:
    if rep is None:
        return None
    by = db.get(User, rep.reported_by)
    return {"id": rep.id, "status": rep.status, "reported_at": rep.reported_at, "activates_at": rep.activates_at,
            "reported_by": by.display_name if by else "", "wait_minutes": settings.death_report_wait_minutes}
