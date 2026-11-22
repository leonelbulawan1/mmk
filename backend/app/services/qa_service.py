"""Orchestrates a question: Prolog decisions FIRST, then the AI over authorised views only."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from ..ai.assistant import Answer, Assistant, LeakGuard, sentence_fingerprints
from ..ai.providers import LLMProvider, make_provider
from ..ai.tools import AuthorizedContext
from ..config import settings
from ..domain.entries import level_rank
from ..models import QAMessage, User
from . import audit
from .policy_service import engine_for
from .vault_service import load_vault


def build_context(db: Session, owner: User, handle: str, today: date,
                  assume_death: bool = False) -> tuple[AuthorizedContext, LeakGuard]:
    # 1. Access decisions are made by Prolog before any content is touched.
    decisions = engine_for(db, owner, assume_death).decide_all(handle, today)
    vault = load_vault(db, owner)
    # 2. Build authorised views; 3. fingerprint everything that is NOT authorised for the leak guard.
    ctx = AuthorizedContext.build(handle, vault.entries, decisions)
    allowed_text, forbidden_text = [], []
    for e in vault.entries:
        lvl = decisions.get(int(e.id)).level if decisions.get(int(e.id)) else "none"
        if e.kind == "letter":
            lvl = "none"
        rank = level_rank(lvl)
        full = [e.title, e.original_text, e.current_text] + [r.text for r in e.revisions]
        if rank >= 3:
            allowed_text += full + [e.summary]
        elif rank == 2:
            allowed_text.append(e.summary)
            forbidden_text += full
        else:
            forbidden_text += full + [e.summary]
    guard = LeakGuard(sentence_fingerprints(forbidden_text) - sentence_fingerprints(allowed_text))
    return ctx, guard


def ask(db: Session, owner: User, asker: User, handle: str, question: str, today: date,
        provider: LLMProvider | None = None) -> Answer:
    # The owner's own preview shows what the beneficiary will see after the owner's passing.
    preview = asker.role == "owner"
    ctx, guard = build_context(db, owner, handle, today, assume_death=preview)
    assistant = Assistant(provider or make_provider(), ctx, guard, settings.llm_max_tool_rounds)
    answer = assistant.ask(question)
    db.add(QAMessage(owner_id=owner.id, asker_id=asker.id, as_handle=handle, question=question,
                     answer=answer.answer, citations_json=json.dumps(answer.citations)))
    audit.record(db, owner.id, asker, "assistant.ask",
                 {"as": handle, "preview": preview, "authorised_entries": len(ctx.views), "retrieved": sorted(ctx.retrieved),
                  "citations": [c["date"] for c in answer.citations], "blocked": answer.blocked,
                  "model": answer.model}, commit=False)
    db.commit()
    return answer
