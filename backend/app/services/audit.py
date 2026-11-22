"""Append-only, hash-chained audit log (one chain per owner)."""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AuditRow, User, now_iso
from ..processing.hashchain import GENESIS, ChainRecord, ChainReport, link_hash, verify_chain


def _payload(row_like: dict) -> dict:
    return {k: row_like[k] for k in ("owner_id", "actor_id", "actor_role", "action", "detail_json", "created_at")}


def record(db: Session, owner_id: int | None, actor: User | None, action: str, detail: dict | None = None,
           commit: bool = True) -> AuditRow:
    last = db.scalars(select(AuditRow).where(AuditRow.owner_id.is_(owner_id) if owner_id is None
                                             else AuditRow.owner_id == owner_id)
                      .order_by(AuditRow.id.desc()).limit(1)).first()
    prev = last.hash if last else GENESIS
    data = {
        "owner_id": owner_id,
        "actor_id": actor.id if actor else None,
        "actor_role": actor.role if actor else "system",
        "action": action,
        "detail_json": json.dumps(detail or {}, sort_keys=True, default=str),
        "created_at": now_iso(),
    }
    row = AuditRow(**data, prev_hash=prev, hash=link_hash(prev, _payload(data)))
    db.add(row)
    if commit:
        db.commit()
    return row


def verify(db: Session, owner_id: int) -> ChainReport:
    rows = db.scalars(select(AuditRow).where(AuditRow.owner_id == owner_id).order_by(AuditRow.id)).all()
    recs = [ChainRecord(i, f"audit:{r.id}", _payload(r.__dict__), r.prev_hash, r.hash) for i, r in enumerate(rows, 1)]
    return verify_chain(recs)


def recent(db: Session, owner_id: int, limit: int = 100) -> list[dict]:
    rows = db.scalars(select(AuditRow).where(AuditRow.owner_id == owner_id)
                      .order_by(AuditRow.id.desc()).limit(limit)).all()
    return [{"id": r.id, "action": r.action, "actor_role": r.actor_role, "actor_id": r.actor_id,
             "detail": json.loads(r.detail_json), "created_at": r.created_at, "hash": r.hash} for r in rows]
