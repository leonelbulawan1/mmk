"""Drafts: unfinished entries and letters, saved on the server so they follow the owner.

Drafts are not in the vault (they can change and be deleted) and are never shared.
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DraftRow, User
from ..security import require_living_owner

router = APIRouter(prefix="/api/drafts", tags=["drafts"])

MAX_DRAFTS = 50
MAX_FORM_BYTES = 200_000
_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")


class DraftIn(BaseModel):
    form: dict
    mode: str = Field(default="", max_length=20)
    saved_at: str | None = Field(default=None, max_length=40)


def _out(r: DraftRow) -> dict:
    try:
        form = json.loads(r.form_json)
    except ValueError:
        form = {}
    return {"id": r.client_id, "form": form, "mode": r.mode, "saved_at": r.saved_at}


def _check_id(draft_id: str) -> None:
    if not _ID.match(draft_id):
        raise HTTPException(400, "That draft id isn't valid.")


@router.get("")
def list_drafts(user: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    rows = db.scalars(select(DraftRow).where(DraftRow.user_id == user.id).order_by(DraftRow.saved_at.desc())).all()
    return [_out(r) for r in rows]


@router.put("/{draft_id}")
def put_draft(draft_id: str, body: DraftIn, user: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    _check_id(draft_id)
    form = {k: v for k, v in body.form.items() if isinstance(k, str) and len(k) <= 40}
    raw = json.dumps(form, ensure_ascii=False)
    if len(raw.encode()) > MAX_FORM_BYTES:
        raise HTTPException(413, "This draft is too long to save. Shorten it or save it as an entry.")
    row = db.scalars(select(DraftRow).where(DraftRow.user_id == user.id, DraftRow.client_id == draft_id)).first()
    if row is None:
        count = len(db.scalars(select(DraftRow.id).where(DraftRow.user_id == user.id)).all())
        if count >= MAX_DRAFTS:
            raise HTTPException(409, f"You have {MAX_DRAFTS} drafts. Finish or delete some before starting another.")
        row = DraftRow(user_id=user.id, client_id=draft_id)
        db.add(row)
    elif body.saved_at and row.saved_at and body.saved_at < row.saved_at:
        return _out(row)  # an older copy arriving late: keep the newer one
    row.form_json = raw
    row.kind = "letter" if form.get("kind") == "letter" else "text"
    row.mode = body.mode or ""
    if body.saved_at:
        row.saved_at = body.saved_at
    db.commit()
    return _out(row)


@router.delete("/{draft_id}", status_code=204)
def delete_draft(draft_id: str, user: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    _check_id(draft_id)
    row = db.scalars(select(DraftRow).where(DraftRow.user_id == user.id, DraftRow.client_id == draft_id)).first()
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
