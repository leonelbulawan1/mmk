"""Executor actions (a beneficiary chosen by the owner)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
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
        raise HTTPException(400, "Your password is incorrect.")
    if body.confirmation.strip() != CONFIRM_PHRASE:
        raise HTTPException(400, f"Type {CONFIRM_PHRASE} exactly to confirm.")
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


class EvidenceIn(BaseModel):
    filename: str = Field(max_length=200)
    content_base64: str = Field(max_length=7_200_000)  # 5 MB file


@router.post("/report/evidence")
def add_evidence(body: EvidenceIn, user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    """The executor adds a document (death certificate) for the reviewer. Stored encrypted; never shown publicly."""
    import base64
    import binascii

    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "We couldn't read that file. Upload a PDF, JPEG or PNG.")
    try:
        death.add_evidence(db, user, body.filename, content)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except death.ReviewError as exc:
        raise HTTPException(400, str(exc))
    return user_out(user, db)


class DisputeIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/dispute")
def dispute(body: DisputeIn, user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    """Any active beneficiary may dispute a report; it then cannot activate until a reviewer looks again."""
    try:
        death.dispute(db, user, body.reason)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except death.ReviewError as exc:
        raise HTTPException(409, str(exc))
    return user_out(user, db)
