"""Append-only storage and hash-chain integrity."""
import pytest
from sqlalchemy import text

from app.models import EntryRow
from app.processing.hashchain import GENESIS, ChainRecord, link_hash, verify_chain
from app.services import vault_service

from .conftest import add_entry, login, make_owner


def _chain(n=3):
    recs, prev = [], GENESIS
    for i in range(1, n + 1):
        payload = {"i": i, "text": f"entry {i}"}
        h = link_hash(prev, payload)
        recs.append(ChainRecord(i, f"r{i}", payload, prev, h))
        prev = h
    return recs


def test_pure_chain_valid():
    report = verify_chain(_chain())
    assert report.ok and report.length == 3


def test_pure_chain_detects_modification():
    recs = _chain()
    recs[1] = ChainRecord(2, "r2", {"i": 2, "text": "EDITED"}, recs[1].prev_hash, recs[1].hash)
    report = verify_chain(recs)
    assert not report.ok and any("modified" in p.problem for p in report.problems)


def test_pure_chain_detects_deletion():
    recs = _chain(4)
    del recs[1]
    report = verify_chain(recs)
    assert not report.ok and any("gap" in p.problem for p in report.problems)


def test_vault_chain_links_entries_and_revisions(db):
    owner = make_owner(db)
    add_entry(db, owner, "First words.", "2020-01-01")
    add_entry(db, owner, "teh second.", "2020-01-02", mode="light_fix")
    vault = vault_service.load_vault(db, owner)
    records = vault.chain_records()
    assert [r.seq for r in records] == [1, 2, 3]
    assert records[0].prev_hash == GENESIS
    assert records[1].prev_hash == records[0].hash and records[2].prev_hash == records[1].hash
    assert vault.verify().ok


def test_orm_refuses_updates_and_deletes(db):
    owner = make_owner(db)
    e = add_entry(db, owner, "Untouchable.", "2020-01-01")
    row = db.get(EntryRow, e.id)
    row.original_text = "changed"
    with pytest.raises(PermissionError):
        db.commit()
    db.rollback()
    row = db.get(EntryRow, e.id)
    db.delete(row)
    with pytest.raises(PermissionError):
        db.commit()
    db.rollback()


def test_database_trigger_refuses_raw_update(db):
    owner = make_owner(db)
    add_entry(db, owner, "Untouchable.", "2020-01-01")
    with pytest.raises(Exception, match="append-only"):
        db.execute(text("UPDATE entries SET original_text='x'"))
    db.rollback()


def test_tampering_that_bypasses_guards_is_detected(db, client):
    owner = make_owner(db)
    add_entry(db, owner, "The original truth.", "2020-01-01")
    add_entry(db, owner, "Another day.", "2020-01-02")
    # An attacker with direct database access removes the trigger and edits the text.
    if db.bind.dialect.name == "postgresql":
        db.execute(text("ALTER TABLE entries DISABLE TRIGGER entries_append_only"))
    else:
        db.execute(text("DROP TRIGGER entries_no_update"))
    db.execute(text("UPDATE entries SET original_text='A forged memory.' WHERE seq=1"))
    db.commit()
    report = vault_service.load_vault(db, owner).verify()
    assert not report.ok
    assert report.problems[0].ref.startswith("entry:") and report.problems[0].seq == 1
    r = client.get("/api/vault/verify", headers=login(client, owner.email))
    assert r.status_code == 200 and r.json()["ok"] is False


def test_policy_and_audit_chains_verify(db, client):
    owner = make_owner(db)
    h = login(client, owner.email)
    add_entry(db, owner, "Hello.", "2020-01-01")
    assert client.put("/api/policy", headers=h, json={"source": "# empty\n"}).status_code == 200
    body = client.get("/api/vault/verify", headers=h).json()
    assert body["ok"] and body["policy"]["ok"] and body["audit"]["ok"]
