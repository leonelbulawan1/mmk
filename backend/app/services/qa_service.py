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
from ..domain.protocol import AfterDate, AfterDeath
from ..errors import AmbiguousName
from .policy_service import current_protocol, engine_for, letter_release_rules
from .integrity import ensure_intact
from .vault_service import beneficiary_rows, load_vault


def asker_names(db: Session, owner: User, handle: str) -> set[str] | None:
    """Lower-case names that refer to this beneficiary, for "did he write about me?".
    Raises AmbiguousName when their first name is shared with another of the owner's beneficiaries."""
    rows = beneficiary_rows(db, owner)
    me = next((b for b in rows if b.handle == handle), None)
    if me is None:
        return set()
    first = (me.display_name or "").split()[0].lower() if (me.display_name or "").split() else ""
    names = {n for n in {first, (me.display_name or "").lower(), handle.lower(), handle.split("_")[0].lower()} if n}
    others = [b for b in rows if b.handle != handle and (
        ((b.display_name or "").split()[:1] and (b.display_name or "").split()[0].lower() in names)
        or (b.handle or "").split("_")[0].lower() in names)]
    if others:
        raise AmbiguousName(first or handle, [handle] + [b.handle for b in others])
    return names


def letters_for(vault, protocol, decisions: dict, handle: str, today: date, owner_dead: bool) -> list[dict]:
    """The asker's own letters, as Prolog decided them: released (with text) or sealed (title + opening date).
    Letters that no release rule will ever open, letters denied by the policy and other people's letters
    are left out entirely."""
    rules = letter_release_rules(protocol, handle)
    out = []
    for e in vault.entries:
        if e.kind != "letter" or e.recipient_handle != handle:
            continue
        d = decisions.get(int(e.id))
        base = {"entry_id": int(e.id), "date": e.entry_date.isoformat(), "title": e.title or "Untitled letter"}
        if d and d.level == "verbatim":
            out.append({**base, "status": "released", "text": e.current_text})
            continue
        reason = d.reason if d else ""
        if not rules or not (reason.startswith("pending") or reason == "letter_sealed"):
            continue
        own = e.release_on if e.release_on and e.release_on > today else None
        rule_open_now = any((isinstance(r.condition, AfterDate) and r.condition.when <= today)
                            or (isinstance(r.condition, AfterDeath) and owner_dead) for r in rules)
        rule_dates = [r.condition.when for r in rules if isinstance(r.condition, AfterDate) and r.condition.when > today]
        policy_open = None if rule_open_now else (min(rule_dates) if rule_dates else None)
        dates = [x for x in (own, policy_open) if x]
        out.append({**base, "status": "sealed", "opens_on": max(dates).isoformat() if dates else None})
    return out


def build_context(db: Session, owner: User, handle: str, today: date,
                  assume_death: bool = False) -> tuple[AuthorizedContext, LeakGuard]:
    # 1. Access decisions are made by Prolog before any content is touched.
    decisions = engine_for(db, owner, assume_death).decide_all(handle, today)
    vault = load_vault(db, owner)
    if not assume_death:  # real beneficiary questions: release nothing from a tampered vault
        ensure_intact(db, owner, vault)
    protocol = current_protocol(db, owner)
    try:
        names = asker_names(db, owner, handle)
    except AmbiguousName:
        names = None  # safe action: never guess which person "me" refers to
    letters = letters_for(vault, protocol, decisions, handle, today, assume_death or bool(owner.death_triggered_at))
    # 2. Build authorised views; 3. fingerprint everything that is NOT authorised for the leak guard.
    ctx = AuthorizedContext.build(handle, vault.entries, decisions, names, letters)
    released = {lt["entry_id"] for lt in letters if lt["status"] == "released"}
    allowed_text, forbidden_text = [lt["title"] for lt in letters], []
    for e in vault.entries:
        lvl = decisions.get(int(e.id)).level if decisions.get(int(e.id)) else "none"
        if e.kind == "letter" and int(e.id) not in released:
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
