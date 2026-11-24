from __future__ import annotations

import sys

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.providers import LLMError, make_provider
from ..config import settings, today
from ..db import get_db
from ..models import QAMessage, User, first_name_of
from ..prolog.engine import PrologError
from ..security import current_user, require_beneficiary
from ..services import audit, policy_service, qa_service, vault_service
from ..services.integrity import ensure_intact

router = APIRouter(prefix="/api", tags=["assistant"])


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    as_handle: str | None = None  # owner preview only


def _owner_and_handle(db: Session, user: User, as_handle: str | None) -> tuple[User, str]:
    if user.role == "beneficiary":
        return db.get(User, user.owner_id), user.handle
    if user.role == "owner":
        if not as_handle:
            raise HTTPException(422, "Choose a beneficiary to preview as.")
        if as_handle not in policy_service.handles(db, user):
            raise HTTPException(404, "We couldn't find that beneficiary.")
        return user, as_handle
    raise HTTPException(403, "You don't have permission to do this.")


@router.get("/assistant/info")
def info(user: User = Depends(current_user)):
    try:
        provider = make_provider().describe()
        configured = True
    except LLMError as exc:
        provider, configured = {"provider": settings.llm_provider, "model": settings.llm_model, "error": str(exc)}, False
    return {**provider, "configured": configured}


@router.post("/assistant/ask")
def ask(body: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owner, handle = _owner_and_handle(db, user, body.as_handle)
    if owner.allow_ai_answers is False:
        raise HTTPException(403, f"{owner.display_name} chose not to let the AI assistant answer questions about their "
                                 "diary. Letters and entries they shared can still be read directly.")
    try:
        answer = qa_service.ask(db, owner, user, handle, body.question, today())
    except PrologError as exc:
        audit.record(db, owner.id, user, "assistant.engine_error", {"error": str(exc)[:200]})
        raise HTTPException(503, "The access engine is unavailable, so nothing can be shared right now.")
    except LLMError as exc:
        print(f"[assistant] {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise HTTPException(503, "The AI assistant is unavailable right now. Try again in a few minutes.")
    return answer.to_dict()


@router.get("/assistant/history")
def history(as_handle: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(QAMessage).where(QAMessage.asker_id == user.id)
    if as_handle:
        q = q.where(QAMessage.as_handle == as_handle)
    rows = db.scalars(q.order_by(QAMessage.id.desc()).limit(30)).all()
    return [{"id": r.id, "question": r.question, "answer": r.answer, "citations": json.loads(r.citations_json),
             "as_handle": r.as_handle, "created_at": r.created_at} for r in reversed(rows)]


@router.get("/letters")
def letters(user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    """Letters addressed to this beneficiary that Prolog says are released today."""
    owner = db.get(User, user.owner_id)
    try:
        decisions = policy_service.decisions_for(db, owner, user.handle, today())
    except PrologError:
        raise HTTPException(503, "The access engine is unavailable, so nothing can be shared right now.")
    vault = vault_service.load_vault(db, owner)
    ensure_intact(db, owner, vault, user)
    released = []
    for e in vault.entries:
        if e.kind == "letter" and decisions.get(int(e.id)) and decisions[int(e.id)].level == "verbatim":
            released.append(e.render("verbatim"))
    audit.record(db, owner.id, user, "letters.view", {"released": [r["entry_id"] for r in released]})
    return sorted(released, key=lambda r: r["date"])


@router.get("/beneficiary/overview")
def overview(user: User = Depends(require_beneficiary), db: Session = Depends(get_db)):
    owner = db.get(User, user.owner_id)
    try:
        decisions = policy_service.decisions_for(db, owner, user.handle, today())
    except PrologError:
        raise HTTPException(503, "The access engine is unavailable right now. Try again in a few minutes.")
    vault = vault_service.load_vault(db, owner)
    ensure_intact(db, owner, vault, user)
    kinds = {int(e.id): e.kind for e in vault.entries}
    visible = [d for d in decisions.values() if d.level != "none"]
    return {
        "owner": owner.display_name,
        "owner_first_name": first_name_of(owner),
        "death_triggered": bool(owner.death_triggered_at),
        "shared_entries": sum(1 for d in visible if kinds.get(d.entry_id) == "text"),
        "released_letters": sum(1 for d in visible if kinds.get(d.entry_id) == "letter"),
    }
