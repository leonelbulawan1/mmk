"""MMK reviewers: decide on reports of an owner's passing (DEATH_REVIEW=admin).

A reviewer is an ordinary account whose email is listed in ADMIN_EMAILS. They see only what a decision needs:
the owner's and reporter's names, the dates, the uploaded documents and any dispute. Never diary content.
"""
from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuditRow, DeathReport, User
from ..security import current_user, verify_password
from ..services import death

router = APIRouter(prefix="/api/review", tags=["review"])


def require_reviewer(user: User = Depends(current_user)) -> User:
    if not death.is_reviewer(user):
        raise HTTPException(403, "You need a reviewer account to do this.")
    return user


def case_out(db: Session, rep: DeathReport, full: bool = False) -> dict:
    owner, by = db.get(User, rep.owner_id), db.get(User, rep.reported_by)
    disputer = db.get(User, rep.disputed_by) if rep.disputed_by else None
    out = {**death.report_out(db, rep), "owner_name": owner.display_name if owner else "",
           "reported_by_relationship": (by.relationship if by else "") or "executor",
           "disputed_by": disputer.display_name if disputer else None}
    if full:
        rows = db.scalars(select(AuditRow).where(AuditRow.owner_id == rep.owner_id, AuditRow.action.like("death.%"))
                          .order_by(AuditRow.id)).all()
        import json
        def who(r):
            actor = db.get(User, r.actor_id) if r.actor_id else None
            return "reviewer" if death.is_reviewer(actor) else ("executor" if r.actor_id == rep.reported_by else r.actor_role)
        out["history"] = [{"at": r.created_at, "action": r.action.removeprefix("death."), "by": who(r)}
                          for r in rows if json.loads(r.detail_json or "{}").get("report") == rep.id]
    return out


@router.get("/cases")
def cases(user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    rows = db.scalars(select(DeathReport).where(DeathReport.status != "pending").order_by(DeathReport.id.desc())
                      .limit(100)).all()
    return [case_out(db, r) for r in rows if r.owner_id != user.id]


def _case(db: Session, user: User, rid: int) -> DeathReport:
    rep = db.get(DeathReport, rid)
    if rep is None or rep.owner_id == user.id:
        raise HTTPException(404, "We couldn't find what you were looking for.")
    return rep


@router.get("/cases/{rid}")
def case(rid: int, user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    return case_out(db, _case(db, user, rid), full=True)


@router.get("/evidence/{eid}")
def evidence(eid: int, user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    try:
        ev, content = death.read_evidence(db, user, eid)
    except LookupError:
        raise HTTPException(404, "We couldn't find what you were looking for.")
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    return {"filename": ev.filename, "content_type": ev.content_type, "content_base64": base64.b64encode(content).decode()}


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=2000)
    password: str = ""


def _act(fn, db, user, rep, *args):
    try:
        fn(db, user, rep, *args)
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except death.ReviewError as exc:
        raise HTTPException(409, str(exc))
    return case_out(db, rep, full=True)


@router.post("/cases/{rid}/start")
def start(rid: int, user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    return _act(death.start_review, db, user, _case(db, user, rid))


@router.post("/cases/{rid}/approve")
def approve(rid: int, body: DecisionIn, user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    if not verify_password(body.password, user.password_hash or ""):  # a deliberate act, not a stray click
        raise HTTPException(400, "Your password is incorrect.")
    return _act(death.approve, db, user, _case(db, user, rid), body.note)


@router.post("/cases/{rid}/reject")
def reject(rid: int, body: DecisionIn, user: User = Depends(require_reviewer), db: Session = Depends(get_db)):
    return _act(death.reject, db, user, _case(db, user, rid), body.note)
