from __future__ import annotations

import sys

from collections import Counter
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import today
from ..db import get_db
from ..domain import Entry, LetterEntry, VaultSealedError
from ..models import User
from ..processing.pure import correct, diff, normalize
from ..security import require_living_owner, require_owner
from ..services import vault_service
from ..writing_modes import all_modes, get_mode

router = APIRouter(prefix="/api", tags=["entries"])


class EntryIn(BaseModel):
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=50_000)
    entry_date: date
    mode: Literal["verbatim", "light_fix", "review"] = "verbatim"
    kind: Literal["text", "letter"] = "text"
    recipient: str | None = None
    release_on: date | None = None
    release_on_death: bool = False
    deliver_while_alive: bool = False  # "On a date": opens on release_on even while the owner is alive
    release_days_after_death: int | None = Field(default=None, ge=1, le=36500)  # "N days after my death"

    @model_validator(mode="after")
    def _letter(self):
        if self.kind == "letter":
            if not self.recipient:
                raise ValueError("A letter needs a recipient")
            if self.release_on is None and not self.release_on_death:
                raise ValueError("Choose when the letter opens: on a date, or after your death")
            if self.deliver_while_alive:
                if self.release_on is None:
                    raise ValueError("Choose the date the letter opens")
                if self.release_on_death:
                    raise ValueError("A letter opens either on a date or after your death, not both")
            if self.release_days_after_death and not self.release_on_death:
                raise ValueError("'Days after death' is only for letters that open after your death")
            if self.release_on is not None and self.release_on < today():
                raise ValueError("The opening date cannot be in the past")
        if not normalize(self.text):
            raise ValueError("Entry text is empty")
        if self.entry_date > today():
            raise ValueError("The date of a memory cannot be in the future")
        return self


class PreviewIn(BaseModel):
    text: str = Field(max_length=50_000)
    mode: Literal["verbatim", "light_fix", "review"]


class RevisionIn(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    source: Literal["review", "edit"] = "review"


def entry_summary(e: Entry) -> dict:
    out = {
        "id": e.id, "seq": e.seq, "kind": e.kind, "title": e.title, "entry_date": e.entry_date.isoformat(),
        "created_at": e.created_at.isoformat(), "writing_mode": e.writing_mode,
        "topics": sorted(e.extraction.topics), "names": sorted(e.extraction.names),
        "snippet": e.current_text[:180], "revisions": len(e.revisions), "hash": e.hash,
        "pending_review": e.writing_mode == "review" and not e.revisions and correct(e.original_text).changed,
    }
    if isinstance(e, LetterEntry):
        out.update(recipient=e.recipient_handle, release_on=e.release_on.isoformat() if e.release_on else None,
                   release_on_death=e.release_on_death, deliver_while_alive=e.deliver_while_alive,
                   release_days_after_death=e.release_days_after_death)
    return out


def recipient_names(db: Session, owner: User) -> dict[str, str]:
    """Handle -> display name of the owner's beneficiaries, so letters show "Jose", not "jose"."""
    rows = db.query(User.handle, User.display_name).filter(User.owner_id == owner.id, User.role == "beneficiary")
    return {h: n for h, n in rows if h}


def with_recipient_name(out: dict, names: dict[str, str]) -> dict:
    if out.get("recipient"):
        out["recipient_name"] = names.get(out["recipient"], out["recipient"])
    return out


def entry_detail(e: Entry) -> dict:
    out = entry_summary(e)
    texts = [e.original_text] + [r.text for r in e.revisions]
    out.update(
        original_text=e.original_text, current_text=e.current_text, summary=e.summary, prev_hash=e.prev_hash,
        revision_history=[{"id": r.id, "seq": r.seq, "source": r.source, "created_at": r.created_at.isoformat(),
                           "text": r.text, "hash": r.hash, "prev_hash": r.prev_hash,
                           "diff": [op.to_dict() for op in diff(texts[i], r.text)]}
                          for i, r in enumerate(e.revisions)],
    )
    if out["pending_review"]:
        out["review"] = get_mode("review").process(e.original_text).to_dict()
    return out


@router.get("/writing-modes")
def writing_modes():
    return all_modes()


@router.post("/entries/preview")
def preview(body: PreviewIn, owner: User = Depends(require_owner)):
    """Show what a writing mode would do, without saving anything."""
    return get_mode(body.mode).process(normalize(body.text)).to_dict()


@router.get("/entries")
def list_entries(q: str = "", topic: str = "", kind: str = "", owner: User = Depends(require_owner),
                 db: Session = Depends(get_db)):
    entries = list(vault_service.load_vault(db, owner).entries)
    if q:
        ql = q.lower()
        entries = [e for e in entries if ql in e.current_text.lower() or ql in e.title.lower()
                   or ql in e.original_text.lower()]
    if topic:
        entries = [e for e in entries if topic.lower() in e.extraction.topics]
    if kind in ("text", "letter"):
        entries = [e for e in entries if e.kind == kind]
    entries.sort(key=lambda e: (e.entry_date, e.seq), reverse=True)
    names = recipient_names(db, owner)
    return [with_recipient_name(entry_summary(e), names) for e in entries]


@router.post("/entries", status_code=201)
def create(body: EntryIn, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    try:
        entry, result = vault_service.create_entry(
            db, owner, title=body.title, text=body.text, entry_date=body.entry_date, mode_key=body.mode,
            kind=body.kind, recipient_handle=body.recipient, release_on=body.release_on,
            release_on_death=body.release_on_death, deliver_while_alive=body.deliver_while_alive,
            release_days_after_death=body.release_days_after_death)
    except (ValueError, VaultSealedError) as exc:
        raise HTTPException(400, str(exc))
    out = {"entry": with_recipient_name(entry_detail(entry), recipient_names(db, owner)),
           "mode_result": result.to_dict()}
    if body.kind == "letter":
        out["delivery"] = _deliver_now(db, owner, entry)
    return out


def _deliver_now(db: Session, owner: User, entry) -> dict:
    """A letter whose opening date is today is delivered at once: email + the recipient's home page."""
    from ..models import EmailNotice
    from ..services import notify

    if not entry.deliver_while_alive or entry.release_on > today():
        return {"status": "scheduled", "opens_on": entry.release_on.isoformat() if entry.release_on else None,
                "after_death": bool(entry.release_on_death), "days_after_death": entry.release_days_after_death}
    try:
        notify.notify_owner_letters(db, owner)
    except Exception as exc:
        print(f"[letters] delivery of entry {entry.id} failed: {exc}", file=sys.stderr, flush=True)
    return letter_delivery(db, owner, entry)


def letter_delivery(db: Session, owner: User, entry) -> dict:
    """Has this letter reached its recipient yet (home page + email)?"""
    from ..models import EmailNotice
    from ..services import notify

    if not entry.deliver_while_alive or entry.release_on > today():
        return {"status": "scheduled", "opens_on": entry.release_on.isoformat() if entry.release_on else None,
                "after_death": bool(entry.release_on_death), "days_after_death": entry.release_days_after_death}
    n = db.scalars(select(EmailNotice).where(EmailNotice.owner_id == owner.id, EmailNotice.entry_id == int(entry.id),
                                             EmailNotice.kind == "letter_released")
                   .order_by(EmailNotice.id.desc())).first()
    return {"status": "delivered", "email": n.status if n else "not_sent", "to": n.to_email if n else None,
            "email_problem": notify.email_problem(n) if n else ""}


@router.get("/entries/{entry_id}")
def get_entry(entry_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    e = vault_service.load_vault(db, owner).get(entry_id)
    if e is None:
        raise HTTPException(404, "We couldn't find that entry.")
    out = with_recipient_name(entry_detail(e), recipient_names(db, owner))
    if e.kind == "letter":
        out["delivery"] = letter_delivery(db, owner, e)
    return out


@router.post("/entries/{entry_id}/revisions", status_code=201)
def add_revision(entry_id: int, body: RevisionIn, owner: User = Depends(require_living_owner),
                 db: Session = Depends(get_db)):
    found = vault_service.load_vault(db, owner).get(entry_id)
    if found is not None and found.kind == "letter":
        raise HTTPException(400, "A letter can't be edited once it is sent.")
    try:
        vault_service.append_revision(db, owner, entry_id, body.text, body.source)
    except KeyError:
        raise HTTPException(404, "We couldn't find that entry.")
    except (ValueError, VaultSealedError) as exc:
        raise HTTPException(400, str(exc))
    return entry_detail(vault_service.load_vault(db, owner).get(entry_id))


@router.delete("/entries/{entry_id}", status_code=204)
def delete(entry_id: int, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    """Delete a diary entry. It disappears from every list and is never shared; its records stay
    in the vault's hash chain, so Vault integrity still verifies."""
    try:
        vault_service.delete_entry(db, owner, entry_id)
    except KeyError:
        raise HTTPException(404, "We couldn't find that entry.")
    except (ValueError, VaultSealedError) as exc:
        raise HTTPException(400, str(exc))
    return None


@router.get("/dashboard")
def dashboard(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    from ..services import policy_service

    vault = vault_service.load_vault(db, owner)
    entries = sorted(vault.entries, key=lambda e: (e.entry_date, e.seq), reverse=True)
    topics = Counter(t for e in entries for t in e.extraction.topics)
    report = vault.verify()
    policy = policy_service.current_protocol(db, owner)
    this_year = today().year
    names = recipient_names(db, owner)
    return {
        "owner": owner.display_name,
        "entry_count": sum(1 for e in entries if e.kind == "text"),
        "letter_count": sum(1 for e in entries if e.kind == "letter"),
        "entries_this_year": sum(1 for e in entries if e.entry_date.year == this_year),
        "beneficiary_count": len(vault_service.beneficiary_rows(db, owner)),
        "policy_version": policy.version, "policy_rules": len(policy.rules), "frozen": policy.frozen,
        "integrity": {"ok": report.ok, "length": report.length, "head": report.head},
        "pending_reviews": sum(1 for e in entries if entry_summary(e)["pending_review"]),
        "topics": topics.most_common(8),
        "recent": [with_recipient_name(entry_summary(e), names) for e in entries[:5]],
        "death_triggered_at": owner.death_triggered_at,
    }
