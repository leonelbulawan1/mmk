from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import today
from ..db import get_db
from ..domain import PolicyFrozenError
from ..models import PolicyVersion, User
from ..policy_lang.to_prolog import translate
from ..prolog.engine import PrologError
from ..security import require_living_owner, require_owner
from ..services import policy_service, vault_service

router = APIRouter(prefix="/api", tags=["policy"])
PL_DIR = Path(__file__).resolve().parent.parent / "policy_lang"


class SourceIn(BaseModel):
    source: str = Field(max_length=20_000)


@router.get("/policy")
def get_policy(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    protocol = policy_service.current_protocol(db, owner)
    history = db.scalars(select(PolicyVersion).where(PolicyVersion.owner_id == owner.id)
                         .order_by(PolicyVersion.version.desc())).all()
    return {
        "source": protocol.source, "version": protocol.version, "frozen": protocol.frozen,
        "rules": [r.to_dict() for r in protocol.rules], "prolog": translate(protocol),
        "handles": sorted(policy_service.handles(db, owner)),
        "history": [{"version": h.version, "created_at": h.created_at, "hash": h.hash} for h in history],
    }


@router.get("/policy/versions/{version}")
def get_version(version: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    row = db.scalars(select(PolicyVersion).where(PolicyVersion.owner_id == owner.id,
                                                  PolicyVersion.version == version)).first()
    if row is None:
        raise HTTPException(404, "Version not found")
    return {"version": row.version, "source": row.source, "prolog": row.prolog_facts, "created_at": row.created_at}


@router.post("/policy/validate")
def validate(body: SourceIn, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    return policy_service.compile_for(db, owner, body.source).to_dict()


@router.put("/policy")
def save(body: SourceIn, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    try:
        result, row = policy_service.save_policy(db, owner, body.source)
    except PolicyFrozenError as exc:
        raise HTTPException(403, str(exc))
    except PrologError as exc:
        raise HTTPException(503, f"Access engine unavailable: {exc}")
    if row is None:
        raise HTTPException(422, {"message": "The policy has errors", **result.to_dict()})
    return {**result.to_dict(), "version": row.version, "hash": row.hash}


def _letter_release_out(db: Session, owner: User, handle: str) -> dict:
    if handle not in policy_service.handles(db, owner):
        raise HTTPException(404, "No beneficiary with that handle")
    by = policy_service.letter_releases_for(policy_service.current_protocol(db, owner), handle)
    return {"handle": handle, "released": bool(by), "by": by}


@router.get("/policy/letter-release/{handle}")
def letter_release(handle: str, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Does the policy release letters to this beneficiary? (A letter is only delivered if it does.)"""
    return _letter_release_out(db, owner, handle)


@router.post("/policy/letter-release/{handle}")
def add_letter_release(handle: str, owner: User = Depends(require_living_owner), db: Session = Depends(get_db)):
    """Add `release letters to <handle> after death;` to the policy as a new version."""
    current = _letter_release_out(db, owner, handle)
    if current["released"]:
        return current
    try:
        result, row = policy_service.add_letter_release(db, owner, handle)
    except PolicyFrozenError as exc:
        raise HTTPException(403, str(exc))
    except PrologError as exc:
        raise HTTPException(503, f"Access engine unavailable: {exc}")
    if row is None:
        raise HTTPException(422, {"message": "The policy has errors", **result.to_dict()})
    return {**_letter_release_out(db, owner, handle), "version": row.version}


@router.get("/policy/samples")
def samples():
    return [{"name": p.stem.split("_", 1)[1].replace("_", " ").title(), "file": p.name, "source": p.read_text()}
            for p in sorted((PL_DIR / "samples").glob("*.alp"))]


@router.get("/policy/grammar")
def grammar():
    return {"ebnf": (PL_DIR / "grammar.ebnf").read_text()}


@router.get("/access/matrix")
def matrix(on: date | None = None, after_death: bool = True, owner: User = Depends(require_owner),
           db: Session = Depends(get_db)):
    """Every beneficiary x entry decision, computed by Prolog.

    ``on`` simulates a date; ``after_death`` (default) shows what each beneficiary will see after the
    owner's passing - while the owner is alive, the real answer is always "nothing"."""
    when = on or today()
    try:
        engine = policy_service.engine_for(db, owner, assume_death=after_death)
        result = engine.matrix(when)
    except PrologError as exc:
        raise HTTPException(503, f"Access engine unavailable: {exc}")
    vault = vault_service.load_vault(db, owner)
    protocol = policy_service.current_protocol(db, owner)
    rule_lines = {i: r.line for i, r in enumerate(protocol.rules, start=1)}
    entries = sorted(vault.entries, key=lambda e: (e.entry_date, e.seq), reverse=True)
    return {
        "date": when.isoformat(),
        "death_triggered": bool(owner.death_triggered_at),
        "after_death": after_death or bool(owner.death_triggered_at),
        "beneficiaries": [{"handle": b.handle, "display_name": b.display_name}
                          for b in vault_service.beneficiary_rows(db, owner)],
        "entries": [{"id": e.id, "date": e.entry_date.isoformat(), "title": e.title, "kind": e.kind,
                     "topics": sorted(e.extraction.topics)} for e in entries],
        "decisions": {h: {str(eid): {"level": d.level, "reason": d.reason, "line": _line(d.reason, rule_lines)}
                          for eid, d in ds.items()} for h, ds in result.items()},
    }


@router.get("/entries/{entry_id}/access")
def entry_access(entry_id: int, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Who may read this entry after the owner's passing, and why (Prolog decisions for one entry)."""
    vault = vault_service.load_vault(db, owner)
    if vault.get(entry_id) is None:
        raise HTTPException(404, "Entry not found")
    try:
        result = policy_service.engine_for(db, owner, assume_death=True).matrix(today())
    except PrologError as exc:
        raise HTTPException(503, f"Access engine unavailable: {exc}")
    protocol = policy_service.current_protocol(db, owner)
    rule_lines = {i: r.line for i, r in enumerate(protocol.rules, start=1)}
    people = []
    for b in vault_service.beneficiary_rows(db, owner):
        d = result.get(b.handle, {}).get(entry_id)
        level, reason = (d.level, d.reason) if d else ("none", "not_beneficiary")
        people.append({"handle": b.handle, "display_name": b.display_name, "relationship": b.relationship,
                       "level": level, "reason": reason, "line": _line(reason, rule_lines)})
    return {"entry_id": entry_id, "date": today().isoformat(), "policy_version": protocol.version, "people": people}


def _line(reason: str, lines: dict[int, int]) -> int | None:
    if "(" in reason:
        try:
            return lines.get(int(reason.split("(")[1].rstrip(")")))
        except ValueError:
            return None
    return None
