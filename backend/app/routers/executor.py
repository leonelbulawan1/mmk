"""Executor actions (a beneficiary chosen by the owner)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import require_beneficiary, verify_password
from ..services import death
from .auth import user_out

router = APIRouter(prefix="/api/executor", tags=["executor"])

CONFIRM_PHRASE = "REPORT PASSING"


class ReportIn(BaseModel):
    password: str
    confirmation: str


@router.post("/report")
def report(body: ReportIn, user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    if not verify_password(body.password, user.password_hash or ""):
        raise HTTPException(400, "Password is incorrect")
    if body.confirmation.strip() != CONFIRM_PHRASE:
        raise HTTPException(400, f"Type {CONFIRM_PHRASE} to confirm")
    try:
        death.report(db, user)
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return user_out(user, db)


@router.post("/withdraw")
def withdraw(user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    try:
        death.withdraw_by_executor(db, user)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return user_out(user, db)
