"""Writing modes: Verbatim, Light Fix, Review - original is always preserved."""
import pytest

from app.writing_modes import LightFixMode, ReviewMode, VerbatimMode, WritingMode, get_mode
from app.services import vault_service

from .conftest import add_entry, login, make_owner

MESSY = "i recieved teh news today , it was wierd."


def test_registry_returns_polymorphic_objects():
    for key, cls in (("verbatim", VerbatimMode), ("light_fix", LightFixMode), ("review", ReviewMode)):
        mode = get_mode(key)
        assert isinstance(mode, WritingMode) and isinstance(mode, cls)
    with pytest.raises(ValueError):
        get_mode("rewrite_everything")


def test_verbatim_changes_nothing():
    r = get_mode("verbatim").process(MESSY)
    assert r.revision_text is None and r.suggestions == () and r.original == MESSY


def test_light_fix_produces_revision_but_keeps_original():
    r = get_mode("light_fix").process(MESSY)
    assert r.original == MESSY
    assert r.revision_text == "I received the news today, it was weird."
    assert r.changes


def test_review_only_suggests():
    r = get_mode("review").process(MESSY)
    assert r.revision_text is None
    assert r.suggestions and r.to_dict()["pending_review"] is True


def test_modes_on_clean_text_do_nothing():
    for key in ("verbatim", "light_fix", "review"):
        r = get_mode(key).process("Everything is fine.")
        assert r.revision_text is None and not r.suggestions


def test_stored_entries_preserve_original(db):
    owner = make_owner(db)
    v = add_entry(db, owner, MESSY, "2024-01-01", mode="verbatim")
    lf = add_entry(db, owner, MESSY, "2024-01-02", mode="light_fix")
    rv = add_entry(db, owner, MESSY, "2024-01-03", mode="review")
    vault = vault_service.load_vault(db, owner)
    assert vault.get(v.id).current_text == MESSY and not vault.get(v.id).revisions
    assert vault.get(lf.id).original_text == MESSY
    assert vault.get(lf.id).current_text == "I received the news today, it was weird."
    assert len(vault.get(lf.id).revisions) == 1
    assert vault.get(rv.id).current_text == MESSY and not vault.get(rv.id).revisions
    assert vault.verify().ok


def test_accepting_review_appends_revision_via_api(client, db):
    owner = make_owner(db)
    h = login(client, owner.email)
    r = client.post("/api/entries", headers=h, json={"text": MESSY, "entry_date": "2024-02-02", "mode": "review"})
    assert r.status_code == 201
    entry = r.json()["entry"]
    assert entry["pending_review"] and entry["review"]["suggestions"]
    corrected = "".join(op["after"] if op["op"] != "equal" else op["before"] for op in entry["review"]["suggestions"])
    r = client.post(f"/api/entries/{entry['id']}/revisions", headers=h, json={"text": corrected, "source": "review"})
    assert r.status_code == 201
    body = r.json()
    assert body["original_text"] == MESSY and body["current_text"] == corrected
    assert body["revision_history"][0]["source"] == "review"


def test_preview_endpoint_does_not_save(client, db):
    owner = make_owner(db)
    h = login(client, owner.email)
    r = client.post("/api/entries/preview", headers=h, json={"text": MESSY, "mode": "light_fix"})
    assert r.status_code == 200 and r.json()["revision_text"]
    assert client.get("/api/entries", headers=h).json() == []
