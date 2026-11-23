"""Drafts saved on the server; downloading your data; deleting your account."""
import json

from .conftest import add_entry, login, make_beneficiary, make_owner


def test_drafts_round_trip_and_follow_the_owner(client, db):
    owner = make_owner(db, "drafts.owner@example.com")
    h = login(client, owner.email)
    r = client.put("/api/drafts/dabc123", headers=h, json={"form": {"kind": "text", "title": "Tuesday", "text": "Rainy"}, "mode": "verbatim",
                                                          "saved_at": "2026-11-23T12:00:00Z"})
    assert r.status_code == 200 and r.json()["form"]["title"] == "Tuesday"
    # A second device sees it.
    h2 = login(client, owner.email)
    drafts = client.get("/api/drafts", headers=h2).json()
    assert [d["id"] for d in drafts] == ["dabc123"]
    # An older copy arriving late does not overwrite the newer one.
    client.put("/api/drafts/dabc123", headers=h, json={"form": {"kind": "text", "text": "Old"}, "saved_at": "2026-11-22T12:00:00Z"})
    assert client.get("/api/drafts", headers=h).json()[0]["form"]["text"] == "Rainy"
    assert client.delete("/api/drafts/dabc123", headers=h).status_code == 204
    assert client.get("/api/drafts", headers=h).json() == []


def test_drafts_are_private_to_their_owner(client, db):
    a = make_owner(db, "a.drafts@example.com")
    b = make_owner(db, "b.drafts@example.com")
    client.put("/api/drafts/dsecret1", headers=login(client, a.email), json={"form": {"text": "Mine"}})
    assert client.get("/api/drafts", headers=login(client, b.email)).json() == []


def test_bad_draft_id_is_refused(client, db):
    owner = make_owner(db, "bad.draft@example.com")
    r = client.put("/api/drafts/no spaces!", headers=login(client, owner.email), json={"form": {"text": "x"}})
    assert r.status_code in (400, 404)


def test_export_has_entries_policy_and_drafts(client, db):
    owner = make_owner(db, "export.owner@example.com")
    make_beneficiary(db, owner, "ana", "Ana Cruz")
    add_entry(db, owner, "A day to remember.", "2025-01-01")
    h = login(client, owner.email)
    client.put("/api/drafts/dexport1", headers=h, json={"form": {"text": "Half done"}})
    r = client.get("/api/account/export", headers=h)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = json.loads(r.text)
    assert data["profile"]["email"] == owner.email
    assert data["entries"][0]["original_text"] == "A day to remember."
    assert data["beneficiaries"][0]["handle"] == "ana"
    assert data["drafts"][0]["form"]["text"] == "Half done"


def test_delete_account_erases_everything(client, db):
    owner = make_owner(db, "erase.owner@example.com")
    ben = make_beneficiary(db, owner, "ana", "Ana Cruz")
    add_entry(db, owner, "Private words.", "2025-01-01")
    email, owner_id, ben_id = owner.email, owner.id, ben.id
    h = login(client, email)
    client.put("/api/drafts/derase11", headers=h, json={"form": {"text": "x"}})
    bad = client.post("/api/account/delete", headers=h, json={"password": "wrong-pass-9", "confirmation": "DELETE MY ACCOUNT"})
    assert bad.status_code == 400
    bad = client.post("/api/account/delete", headers=h, json={"password": "testpass123", "confirmation": "delete"})
    assert bad.status_code == 400
    ok = client.post("/api/account/delete", headers=h, json={"password": "testpass123", "confirmation": "DELETE MY ACCOUNT"})
    assert ok.status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401
    r = client.post("/api/auth/login", json={"email": email, "password": "testpass123"})
    assert r.status_code == 401
    from app.models import DraftRow, EntryRow, ErasurePermit, User
    db.expire_all()
    assert db.get(User, owner_id) is None and db.get(User, ben_id) is None
    assert db.query(EntryRow).filter_by(owner_id=owner_id).count() == 0
    assert db.query(ErasurePermit).count() == 0
    assert db.query(DraftRow).count() == 0


def test_beneficiary_cannot_delete_account_here(client, db):
    owner = make_owner(db, "keep.owner@example.com")
    ben = make_beneficiary(db, owner, "ana", "Ana Cruz")
    r = client.post("/api/account/delete", headers=login(client, ben.email), json={"password": "testpass123", "confirmation": "DELETE MY ACCOUNT"})
    assert r.status_code == 403
