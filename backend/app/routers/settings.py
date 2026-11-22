from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..prolog.engine import swipl_available
from ..security import current_user, require_living_owner, require_owner, verify_password
from ..services import audit, death, notify, policy_service
from .auth import user_out

router = APIRouter(prefix="/api/settings", tags=["settings"])

CONFIRM_PHRASE = "SEAL MY VAULT"


class SettingsIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    default_writing_mode: Literal["verbatim", "light_fix", "review"] | None = None
    email_letters: bool | None = None        # beneficiary
    allow_ai_answers: bool | None = None     # owner (consent; recorded in the audit log)


class PasswordIn(BaseModel):
    password: str


class DeathTriggerIn(BaseModel):
    password: str
    confirmation: str


@router.get("")
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"user": user_out(user, db), "prolog_available": swipl_available(), "confirm_phrase": CONFIRM_PHRASE}


@router.put("")
def update(body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.default_writing_mode is not None:
        if user.role != "owner":
            raise HTTPException(403, "Only owners have a writing mode")
        user.default_writing_mode = body.default_writing_mode
    if body.email_letters is not None:
        if user.role != "beneficiary":
            raise HTTPException(403, "Only beneficiaries receive letter emails")
        user.email_letters = body.email_letters
    if body.allow_ai_answers is not None:
        if user.role != "owner":
            raise HTTPException(403, "Only the diary owner decides this")
        if user.death_triggered_at:
            raise HTTPException(403, "The vault is sealed; this can no longer change")
        user.allow_ai_answers = body.allow_ai_answers
    audit.record(db, user.owner_id or user.id, user, "settings.update", body.model_dump(exclude_none=True), commit=False)
    db.commit()
    return user_out(user, db)


@router.post("/death-trigger")
def death_trigger(body: DeathTriggerIn, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    """Irreversible: seals the vault, freezes the policy and starts after-death releases."""
    if not verify_password(body.password, owner.password_hash or ""):
        raise HTTPException(400, "Password is incorrect")
    if body.confirmation.strip() != CONFIRM_PHRASE:
        raise HTTPException(400, f"Type {CONFIRM_PHRASE} to confirm")
    try:
        notices = death.activate(db, owner, owner, via="owner")
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    return {"death_triggered_at": owner.death_triggered_at,
            "frozen_policy_version": policy_service.current_protocol(db, owner).version,
            "notices": notify.list_notices(db, owner), "emails_sent": sum(n.status == "sent" for n in notices),
            "email_configured": notify.smtp_configured()}


class ExecutorIn(BaseModel):
    beneficiary_id: int | None = None


@router.put("/executor")
def set_executor(body: ExecutorIn, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    """Choose which beneficiary may report the owner's passing (or None to have no executor)."""
    if body.beneficiary_id is not None:
        b = db.get(User, body.beneficiary_id)
        if b is None or b.owner_id != owner.id or b.role != "beneficiary":
            raise HTTPException(404, "Beneficiary not found")
        if not b.active or b.password_hash is None:
            raise HTTPException(400, "The executor must have an active, activated account")
    if death.pending_report(db, owner.id):
        raise HTTPException(400, "Cancel the waiting report before changing your executor")
    owner.executor_id = body.beneficiary_id
    audit.record(db, owner.id, owner, "executor.set", {"beneficiary_id": body.beneficiary_id}, commit=False)
    db.commit()
    return user_out(owner, db)


@router.post("/death-report/cancel")
def cancel_report(owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    """\"I'm still here\": cancel an executor's report during the waiting period."""
    try:
        death.cancel_by_owner(db, owner)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return user_out(owner, db)


@router.get("/notifications")
def notifications(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    return {"email_configured": notify.smtp_configured(), "notices": notify.list_notices(db, owner)}


@router.post("/notifications/{notice_id}/retry")
def retry_notification(notice_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    try:
        notify.retry(db, owner, notice_id)
    except KeyError:
        raise HTTPException(404, "Notice not found")
    return {"email_configured": notify.smtp_configured(), "notices": notify.list_notices(db, owner)}
