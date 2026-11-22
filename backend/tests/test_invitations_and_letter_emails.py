"""Invitation emails to new beneficiaries, and an email when a letter opens (never its text)."""
from datetime import date

import pytest
from sqlalchemy import select

from app.models import EmailNotice
from app.prolog.engine import swipl_available
from app.services import notify

from .conftest import add_entry, login, make_beneficiary, make_owner, set_policy
from .test_death_notices import FakeSMTP, _trigger, smtp  # noqa: F401  (fixture)

LETTER = "Dear Maria, the recipe card is in the blue tin."


def _bodies():
    return [m.get_content() for m in FakeSMTP.sent]


def test_adding_a_beneficiary_emails_the_invitation(client, db, smtp):
    owner = make_owner(db, "rosa.inv@example.com", "Rosa Dizon")
    h = login(client, owner.email)
    r = client.post("/api/beneficiaries", headers=h, json={"display_name": "Maria Dizon", "email": "maria.inv@gmail.com",
                                                           "handle": "maria", "relationship": "daughter"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invitation"] == {"status": "sent", "to": "maria.inv@gmail.com", "error": ""}
    msg = FakeSMTP.sent[-1]
    assert msg["To"] == "maria.inv@gmail.com" and "Rosa Dizon invited you" in msg["Subject"]
    text = msg.get_content()
    assert body["invite_code"] in text and "/activate" in text and "Nothing in Rosa's diary is shared" in text
    # Sending it again issues a new code and a new email.
    again = client.post(f"/api/beneficiaries/{body['beneficiary']['id']}/invite", headers=h).json()
    assert again["invitation"]["status"] == "sent" and again["invite_code"] in FakeSMTP.sent[-1].get_content()


def test_without_email_set_up_the_owner_still_gets_the_link(client, db):
    owner = make_owner(db, "rosa.noemail@example.com", "Rosa Dizon")
    r = client.post("/api/beneficiaries", headers=login(client, owner.email),
                    json={"display_name": "Jose Dizon", "email": "jose.noemail@gmail.com", "handle": "jose"})
    assert r.status_code == 201
    assert r.json()["invitation"]["status"] == "not_configured" and r.json()["invite_link"]


@pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")
def test_letter_opening_on_a_later_date_emails_its_recipient_once(client, db, smtp, monkeypatch):
    owner = make_owner(db, "juan.letters@example.com", "Juan Santos")
    maria = make_beneficiary(db, owner, "maria", "Maria Santos")
    make_beneficiary(db, owner, "adam_jr", "Adam Santos Jr")
    add_entry(db, owner, LETTER, "2025-01-01", title="To my daughter", kind="letter", recipient_handle="maria",
              release_on=date(2040, 5, 1), release_on_death=False)
    set_policy(db, owner, "release letters to maria after 2040-05-01;")
    _trigger(client, owner)  # nothing is released yet, so no one is emailed
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0

    monkeypatch.setattr(notify, "today", lambda: date(2040, 5, 2))
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 1
    msg = FakeSMTP.sent[-1]
    assert msg["To"] == maria.email and "A letter from Juan Santos" in msg["Subject"]
    assert "To my daughter" in msg.get_content() and "recipe" not in msg.get_content()  # never the letter's text
    assert "not a legal will" in msg.get_content()
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0  # only once
    kinds = db.scalars(select(EmailNotice.kind).where(EmailNotice.owner_id == owner.id)).all()
    assert kinds.count("letter_released") == 1


@pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")
def test_letters_in_the_death_notice_are_not_emailed_twice(client, db, smtp):
    owner = make_owner(db, "ana.letters@example.com", "Ana Cruz")
    make_beneficiary(db, owner, "carla", "Carla Cruz")
    add_entry(db, owner, "Dear Carla, be brave.", "2022-01-01", title="For Carla", kind="letter",
              recipient_handle="carla", release_on=None, release_on_death=True)
    set_policy(db, owner, "release letters to carla after death;")
    _trigger(client, owner)
    before = len(FakeSMTP.sent)
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0
    assert len(FakeSMTP.sent) == before
