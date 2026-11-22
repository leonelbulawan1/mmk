from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PolicyVersion, User
from ..processing.hashchain import ChainRecord, verify_chain
from ..security import require_owner
from ..services import audit, vault_service
from ..services.integrity import policy_chain

router = APIRouter(prefix="/api/vault", tags=["vault"])


@router.get("/verify")
def verify(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    vault = vault_service.load_vault(db, owner)
    entries = vault.verify()
    policy = policy_chain(db, owner)
    audit_report = audit.verify(db, owner.id)
    audit.record(db, owner.id, owner, "vault.verify",
                 {"entries_ok": entries.ok, "policy_ok": policy.ok, "audit_ok": audit_report.ok, "head": entries.head})
    records = [{"seq": r.seq, "ref": r.ref, "prev_hash": r.prev_hash, "hash": r.hash,
                "kind": r.payload.get("kind"), "date": r.payload.get("entry_date"), "title": r.payload.get("title")}
               for r in vault.chain_records()]
    return {"ok": entries.ok and policy.ok and audit_report.ok, "entries": entries.to_dict(),
            "policy": policy.to_dict(), "audit": audit_report.to_dict(), "records": records,
            "sealed": vault.sealed}


@router.get("/audit")
def audit_log(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    return audit.recent(db, owner.id, 150)


@router.get("/export")
def export(owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    """Full owner-side export of the vault with hashes, so it can be verified independently."""
    vault = vault_service.load_vault(db, owner)
    audit.record(db, owner.id, owner, "vault.export", {"records": len(vault.chain_records())})
    return {"owner": owner.display_name, "head": vault.head,
            "records": [{"seq": r.seq, "ref": r.ref, "payload": r.payload, "prev_hash": r.prev_hash, "hash": r.hash}
                        for r in vault.chain_records()]}
