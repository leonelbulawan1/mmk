"""Maps persisted rows <-> domain objects and performs append-only writes."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import Beneficiary, Entry, LetterEntry, Owner, Revision, TextEntry, Vault
from ..models import EntryRow, RevisionRow, User
from ..processing.pure import Extraction, extract, normalize, summarize
from ..writing_modes import ModeResult, get_mode
from . import audit


# ---- mapping --------------------------------------------------------------------------
def owner_from_row(u: User) -> Owner:
    return Owner(u.id, u.email, u.display_name, u.password_hash or "",
                 datetime.fromisoformat(u.death_triggered_at) if u.death_triggered_at else None)


def beneficiary_from_row(u: User) -> Beneficiary:
    return Beneficiary(u.id, u.email, u.display_name, u.password_hash or "", u.owner_id, u.handle,
                       u.relationship, u.active)


def entry_from_rows(row: EntryRow, revs: list[RevisionRow]) -> Entry:
    revisions = tuple(
        Revision(r.id, r.entry_id, r.seq, r.text, r.source, datetime.fromisoformat(r.created_at), r.prev_hash, r.hash)
        for r in sorted(revs, key=lambda r: r.seq)
    )
    common = dict(
        entry_id=row.id, owner_id=row.owner_id, seq=row.seq, title=row.title, original_text=row.original_text,
        entry_date=date.fromisoformat(row.entry_date), created_at=datetime.fromisoformat(row.created_at),
        writing_mode=row.writing_mode,
        extraction=Extraction(frozenset(json.loads(row.names_json)), frozenset(json.loads(row.topics_json))),
        summary=row.summary, prev_hash=row.prev_hash, hash=row.hash, revisions=revisions,
    )
    if row.kind == "letter":
        return LetterEntry(recipient_handle=row.recipient_handle or "",
                           release_on=date.fromisoformat(row.release_on) if row.release_on else None,
                           release_on_death=row.release_on_death,
                           deliver_while_alive=bool(getattr(row, "deliver_while_alive", False)),
                           release_days_after_death=getattr(row, "release_days_after_death", None), **common)
    return TextEntry(**common)


def load_vault(db: Session, owner: User) -> Vault:
    rows = db.scalars(select(EntryRow).where(EntryRow.owner_id == owner.id).order_by(EntryRow.seq)).all()
    revs = db.scalars(select(RevisionRow).where(RevisionRow.owner_id == owner.id)).all()
    by_entry: dict[int, list[RevisionRow]] = {}
    for r in revs:
        by_entry.setdefault(r.entry_id, []).append(r)
    entries = tuple(entry_from_rows(r, by_entry.get(r.id, [])) for r in rows)
    return Vault(owner.id, entries, sealed=bool(owner.death_triggered_at))


def beneficiary_rows(db: Session, owner: User, active_only: bool = True) -> list[User]:
    q = select(User).where(User.owner_id == owner.id, User.role == "beneficiary")
    if active_only:
        q = q.where(User.active.is_(True))
    return list(db.scalars(q.order_by(User.display_name)).all())


def known_names(db: Session, owner: User) -> list[str]:
    names: list[str] = []
    for b in beneficiary_rows(db, owner, active_only=False):
        names.append(b.handle)
        names.extend(b.display_name.split())
    return names


# ---- writes ---------------------------------------------------------------------------
def create_entry(db: Session, owner: User, *, title: str, text: str, entry_date: date, mode_key: str,
                 kind: str = "text", recipient_handle: str | None = None, release_on: date | None = None,
                 release_on_death: bool = False, deliver_while_alive: bool = False,
                 release_days_after_death: int | None = None) -> tuple[Entry, ModeResult]:
    mode = get_mode(mode_key)  # polymorphic writing behaviour
    vault = load_vault(db, owner)
    original = normalize(text)
    extraction = extract(original, known_names(db, owner))
    common = dict(entry_id=None, owner_id=owner.id, seq=vault.next_seq, title=title or "", original_text=original,
                  entry_date=entry_date, created_at=datetime.now(timezone.utc), writing_mode=mode.key,
                  extraction=extraction, summary=summarize(original, extraction))
    if kind == "letter":
        if not recipient_handle:
            raise ValueError("A letter needs a recipient")
        handles = {b.handle for b in beneficiary_rows(db, owner)}
        if recipient_handle not in handles:
            raise ValueError("Unknown recipient")
        entry: Entry = LetterEntry(recipient_handle=recipient_handle, release_on=release_on,
                                   release_on_death=release_on_death, deliver_while_alive=deliver_while_alive,
                                   release_days_after_death=release_days_after_death,
                                   **common)
    else:
        entry = TextEntry(**common)

    sealed = vault.append_entry(entry)
    names, topics = extraction.as_sorted()
    row = EntryRow(owner_id=owner.id, seq=sealed.seq, kind=sealed.kind, title=sealed.title,
                   original_text=sealed.original_text, entry_date=sealed.entry_date.isoformat(),
                   created_at=sealed.created_at.isoformat(), writing_mode=sealed.writing_mode,
                   names_json=json.dumps(list(names)), topics_json=json.dumps(list(topics)), summary=sealed.summary,
                   recipient_handle=getattr(sealed, "recipient_handle", None),
                   release_on=sealed.release_on.isoformat() if getattr(sealed, "release_on", None) else None,
                   release_on_death=bool(getattr(sealed, "release_on_death", False)),
                   deliver_while_alive=bool(getattr(sealed, "deliver_while_alive", False)),
                   release_days_after_death=getattr(sealed, "release_days_after_death", None),
                   prev_hash=sealed.prev_hash, hash=sealed.hash)
    db.add(row)
    db.flush()
    sealed = vault.register_id(sealed, row.id)

    result = mode.process(original)
    if result.revision_text is not None:  # Light Fix appends a revision immediately
        _persist_revision(db, owner, vault.append_revision(row.id, result.revision_text, mode.key))
        sealed = vault.get(row.id)
    audit.record(db, owner.id, owner, "entry.create",
                 {"entry_id": row.id, "seq": row.seq, "kind": kind, "mode": mode.key, "hash": row.hash}, commit=False)
    db.commit()
    return sealed, result


def _persist_revision(db: Session, owner: User, rev: Revision) -> RevisionRow:
    row = RevisionRow(entry_id=rev.entry_id, owner_id=owner.id, seq=rev.seq, text=rev.text, source=rev.source,
                      created_at=rev.created_at.isoformat(), prev_hash=rev.prev_hash, hash=rev.hash)
    db.add(row)
    db.flush()
    return row


def append_revision(db: Session, owner: User, entry_id: int, text: str, source: str = "review") -> Revision:
    vault = load_vault(db, owner)
    if vault.get(entry_id) is None:
        raise KeyError(entry_id)
    rev = vault.append_revision(entry_id, normalize(text), source)
    row = _persist_revision(db, owner, rev)
    audit.record(db, owner.id, owner, "entry.revise", {"entry_id": entry_id, "seq": rev.seq, "source": source},
                 commit=False)
    db.commit()
    return Revision(**{**rev.__dict__, "id": row.id})
