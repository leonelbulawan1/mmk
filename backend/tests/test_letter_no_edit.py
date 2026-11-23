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
