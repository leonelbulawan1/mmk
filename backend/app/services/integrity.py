"""Fail-closed integrity gate: before any diary content is released to a beneficiary (assistant,
letters, overview), the entry chain and the policy chain are recomputed. If either fails, TamperDetected
is raised and nothing is shared. The owner can still open the vault to see what went wrong."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import TamperDetected
from ..models import PolicyVersion, User
from ..processing.hashchain import ChainRecord, ChainReport, verify_chain
from . import audit


def policy_chain(db: Session, owner: User) -> ChainReport:
    rows = db.scalars(select(PolicyVersion).where(PolicyVersion.owner_id == owner.id)
                      .order_by(PolicyVersion.version)).all()
    return verify_chain(ChainRecord(r.version, f"policy:v{r.version}",
                                    {"owner_id": r.owner_id, "version": r.version, "source": r.source,
                                     "rules_json": r.rules_json}, r.prev_hash, r.hash) for r in rows)


def ensure_intact(db: Session, owner: User, vault, asker: User | None = None) -> None:
    """Raise TamperDetected if the entries or the policy no longer match their hash chains."""
    for chain, report in (("entries", vault.verify()), ("policy", policy_chain(db, owner))):
        if not report.ok:
            first = report.problems[0].seq if report.problems else None
            audit.record(db, owner.id, asker, "integrity.failed", {"chain": chain, "record": first,
                                                                     "problems": len(report.problems)})
            raise TamperDetected(chain, first)
