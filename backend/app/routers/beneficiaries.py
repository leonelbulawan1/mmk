from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..policy_lang.lexer import KEYWORDS
from ..security import require_living_owner, require_owner
from ..services import audit
from .auth import hash_invite, new_code

router = APIRouter(prefix="/api/beneficiaries", tags=["beneficiaries"])

HANDLE_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


class BeneficiaryIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    handle: str = Field(min_length=2, max_length=32)
    relationship: str = Field(default="", max_length=80)


class BeneficiaryPatch(BaseModel):
    relationship: str | None = Field(default=None, max_length=80)
    active: bool | None = None


def out(b: User) -> dict:
    return {"id": b.id, "display_name": b.display_name, "email": b.email, "handle": b.handle,
            "relationship": b.relationship, "active": b.active, "activated": b.password_hash is not None,
            "created_at": b.created_at}


def _invite() -> str:
    return new_code()


def _get(db: Session, owner: User, bid: int) -> User:
    b = db.get(User, bid)
    if b is None or b.owner_id != owner.id or b.role != "beneficiary":
        raise HTTPException(404, "Beneficiary not found")
    return b


@router.get("")
def list_beneficiaries(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.owner_id == owner.id, User.role == "beneficiary")
                      .order_by(User.display_name)).all()
    return [out(b) for b in rows]


@router.post("", status_code=201)
def create(body: BeneficiaryIn, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    handle = body.handle.strip().lower()
    if not HANDLE_RE.match(handle) or handle in KEYWORDS:
        raise HTTPException(422, "Handle must be 2-32 lowercase letters, digits or _ and not a policy keyword")
    if db.scalars(select(User).where(User.email == body.email.lower())).first():
        raise HTTPException(409, "That email is already registered")
    if db.scalars(select(User).where(User.owner_id == owner.id, User.handle == handle)).first():
        raise HTTPException(409, "That handle is already used")
    code = _invite()
    b = User(role="beneficiary", email=body.email.lower(), display_name=body.display_name.strip(), owner_id=owner.id,
             handle=handle, relationship=body.relationship.strip(), invite_code_hash=hash_invite(code))
    db.add(b)
    db.flush()
    audit.record(db, owner.id, owner, "beneficiary.create", {"handle": handle}, commit=False)
    db.commit()
    return {"beneficiary": out(b), "invite_code": code, "invite_link": _link(b, code),
            "invitation": _email_invitation(db, owner, b, code)}


def _email_invitation(db: Session, owner: User, b: User, code: str) -> dict:
    """Send the invitation by email; the owner still gets the link and code if sending is not possible."""
    from ..services import notify

    try:
        notice = notify.send_invitation(db, owner, b, code)
        return {"status": notice.status, "to": b.email, "error": notice.error}
    except Exception as exc:  # the beneficiary is created either way
        db.rollback()
        return {"status": "failed", "to": b.email, "error": str(exc)[:200]}


def _link(b: User, code: str) -> str:
    from ..services.notify import activation_link

    return activation_link(b.email, code)


@router.post("/{bid}/invite")
def reissue_invite(bid: int, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    b = _get(db, owner, bid)
    if b.password_hash is not None:
        raise HTTPException(400, "This beneficiary has already activated their account")
    code = _invite()
    b.invite_code_hash = hash_invite(code)
    audit.record(db, owner.id, owner, "beneficiary.invite", {"handle": b.handle}, commit=False)
    db.commit()
    return {"beneficiary": out(b), "invite_code": code, "invite_link": _link(b, code),
            "invitation": _email_invitation(db, owner, b, code)}


@router.patch("/{bid}")
def update(bid: int, body: BeneficiaryPatch, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    b = _get(db, owner, bid)
    if body.relationship is not None:
        b.relationship = body.relationship.strip()
    if body.active is not None:
        b.active = body.active
    audit.record(db, owner.id, owner, "beneficiary.update",
                 {"handle": b.handle, "active": b.active, "relationship": b.relationship}, commit=False)
    db.commit()
    return out(b)
