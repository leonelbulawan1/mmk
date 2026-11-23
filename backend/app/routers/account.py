"""Your data: download everything, or delete your account.

Deleting an owner's account erases the whole diary: entries, revisions, letters, policy versions,
the audit log, drafts, email notices, questions and answers, reports and evidence, and the
beneficiary accounts that belong to it. This is the one place where append-only rows are removed,
because the person whose data it is asked for it to be erased.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (AuditRow, DeathEvidence, DeathReport, DraftRow, EmailNotice, EntryRow, ErasurePermit, PolicyVersion,
                      QAMessage, RevisionRow, User)
from ..security import current_user
from ..security_hashing import verify_password
from ..services import vault_service
from ..models import now_iso

router = APIRouter(prefix="/api/account", tags=["account"])

DELETE_PHRASE = "DELETE MY ACCOUNT"


def _profile(u: User) -> dict:
    return {"name": u.display_name, "email": u.email, "role": u.role, "created_at": u.created_at,
            "writing_mode": u.default_writing_mode if u.role == "owner" else None,
            "email_letters": u.email_letters if u.role == "beneficiary" else None}


@router.get("/export")
def export(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything MMK keeps about you, as one JSON file."""
    out: dict = {"exported_at": now_iso(), "format": "mmk-export-1", "profile": _profile(user)}
    if user.role == "owner":
        vault = vault_service.load_vault(db, user)
        names = {b.handle: b.display_name for b in db.scalars(select(User).where(User.owner_id == user.id))}
        out["entries"] = [{
            "kind": e.kind, "date": e.entry_date.isoformat(), "title": e.title,
            "written_at": e.created_at, "writing_mode": e.writing_mode,
            "original_text": e.original_text, "current_text": e.current_text,
            "revisions": [{"text": r.text, "source": r.source, "at": r.created_at} for r in e.revisions],
            **({"to": names.get(e.recipient_handle, e.recipient_handle),
                "release_on": e.release_on.isoformat() if e.release_on else None,
                "after_passing": e.release_on_death} if e.kind == "letter" else {}),
            "seq": e.seq, "hash": e.hash,
        } for e in vault.entries]
        out["beneficiaries"] = [{"name": b.display_name, "email": b.email, "handle": b.handle,
                                 "activated": bool(b.password_hash), "active": b.active, "added": b.created_at}
                                for b in db.scalars(select(User).where(User.owner_id == user.id))]
        out["policy_versions"] = [{"version": p.version, "source": p.source, "saved_at": p.created_at}
                                  for p in db.scalars(select(PolicyVersion).where(PolicyVersion.owner_id == user.id)
                                                      .order_by(PolicyVersion.version))]
        out["drafts"] = [{"form": json.loads(d.form_json or "{}"), "saved_at": d.saved_at}
                         for d in db.scalars(select(DraftRow).where(DraftRow.user_id == user.id))]
        out["activity_log"] = [{"action": a.action, "by": a.actor_role, "at": a.created_at, "detail": json.loads(a.detail_json or "{}")}
                               for a in db.scalars(select(AuditRow).where(AuditRow.owner_id == user.id).order_by(AuditRow.id))]
    else:
        out["questions"] = [{"question": q.question, "answer": q.answer, "at": q.created_at}
                            for q in db.scalars(select(QAMessage).where(QAMessage.asker_id == user.id).order_by(QAMessage.id))]
    body = json.dumps(out, ensure_ascii=False, indent=2, default=str)
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="mmk-my-data.json"'})


class DeleteIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    confirmation: str = Field(max_length=40)


@router.post("/delete", status_code=204)
def delete_account(body: DeleteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "owner":
        raise HTTPException(403, "Only the diary owner can remove a beneficiary account. Ask them to deactivate you.")
    if user.death_triggered_at:
        raise HTTPException(400, "This vault is sealed, so the account can no longer be deleted.")
    if not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Your password is incorrect.")
    if body.confirmation != DELETE_PHRASE:
        raise HTTPException(400, f"Type {DELETE_PHRASE} exactly to confirm.")
    erase_owner(db, user.id)
    return Response(status_code=204)


def erase_owner(db: Session, owner_id: int) -> None:
    """Remove an owner and everything that belongs to their diary, in one transaction.
    Bulk deletes skip the ORM's append-only guards on purpose (see the module docstring)."""
    people = [owner_id] + list(db.scalars(select(User.id).where(User.owner_id == owner_id)))
    db.add(ErasurePermit(owner_id=owner_id))
    db.flush()
    reports = list(db.scalars(select(DeathReport.id).where(DeathReport.owner_id == owner_id)))
    if reports:
        db.execute(delete(DeathEvidence).where(DeathEvidence.report_id.in_(reports)))
    for model, col in ((DeathReport, DeathReport.owner_id), (QAMessage, QAMessage.owner_id),
                       (EmailNotice, EmailNotice.owner_id), (RevisionRow, RevisionRow.owner_id),
                       (EntryRow, EntryRow.owner_id), (PolicyVersion, PolicyVersion.owner_id),
                       (AuditRow, AuditRow.owner_id)):
        db.execute(delete(model).where(col == owner_id))
    db.execute(delete(DraftRow).where(DraftRow.user_id.in_(people)))
    db.execute(delete(User).where(User.owner_id == owner_id))
    db.execute(delete(User).where(User.id == owner_id))
    db.execute(delete(ErasurePermit).where(ErasurePermit.owner_id == owner_id))
    db.commit()
