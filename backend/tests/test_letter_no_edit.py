"""A diary entry can be edited (each edit is a new revision; the original stays);
a letter cannot be edited once it is sent."""
from .conftest import add_entry, login, make_beneficiary, make_owner


def test_diary_entry_can_be_edited(client, db):
    owner = make_owner(db, "edit.owner@example.com")
    e = add_entry(db, owner, "First words.", "2025-01-01")
    r = client.post(f"/api/entries/{e.id}/revisions", headers=login(client, owner.email), json={"text": "Better words.", "source": "edit"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["current_text"] == "Better words." and body["original_text"] == "First words."


def test_letter_cannot_be_edited(client, db):
    owner = make_owner(db, "letter.owner@example.com")
    make_beneficiary(db, owner, "ana", "Ana Cruz")
    e = add_entry(db, owner, "Dear Ana.", "2025-01-01", kind="letter", recipient_handle="ana", release_on_death=True)
    r = client.post(f"/api/entries/{e.id}/revisions", headers=login(client, owner.email), json={"text": "Changed.", "source": "edit"})
    assert r.status_code == 400 and "letter" in r.json()["detail"].lower()


def test_diary_entry_can_be_deleted_and_the_vault_still_verifies(client, db):
    owner = make_owner(db, "delete.owner@example.com")
    make_beneficiary(db, owner, "ana", "Ana Cruz")
    keep = add_entry(db, owner, "Keep this one.", "2025-01-01")
    gone = add_entry(db, owner, "Delete this one.", "2025-01-02")
    h = login(client, owner.email)
    assert client.delete(f"/api/entries/{gone.id}", headers=h).status_code == 204
    ids = [e["id"] for e in client.get("/api/entries", headers=h).json()]
    assert ids == [keep.id]
    assert client.get(f"/api/entries/{gone.id}", headers=h).status_code == 404
    assert client.post(f"/api/entries/{gone.id}/revisions", headers=h, json={"text": "Back?", "source": "edit"}).status_code == 404
    v = client.get("/api/vault/verify", headers=h).json()
    assert v["entries"]["ok"] is True
    assert not any("Delete this one" in (r.get("title") or "") for r in v["records"])
    matrix = client.get("/api/access/matrix", headers=h).json()
    assert gone.id not in [e["id"] for e in matrix["entries"]]


def test_letter_cannot_be_deleted(client, db):
    owner = make_owner(db, "letter.delete@example.com")
    make_beneficiary(db, owner, "ana", "Ana Cruz")
    e = add_entry(db, owner, "Dear Ana.", "2025-01-01", kind="letter", recipient_handle="ana", release_on_death=True)
    r = client.delete(f"/api/entries/{e.id}", headers=login(client, owner.email))
    assert r.status_code == 400
