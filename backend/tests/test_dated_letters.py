"""Letters set to open on a date are delivered on that date, even while the owner is alive:
an email to the recipient and the letter on their home page. Nothing else opens early."""
from datetime import date, timedelta

import pytest

from app.config import today
from app.services import notify

from .conftest import add_entry, login, make_beneficiary, make_owner
from .test_death_notices import FakeSMTP, smtp  # noqa: F401  (fixture)

pytestmark = pytest.mark.skipif(not __import__("app.prolog.engine", fromlist=["x"]).swipl_available(),
                                reason="SWI-Prolog is required")


def _setup(db):
    owner = make_owner(db, "kean.letters@example.com", "Kean Gito")
    roby = make_beneficiary(db, owner, "roby", "Roby Flores")
    ana = make_beneficiary(db, owner, "ana", "Ana Cruz")
    add_entry(db, owner, "A private memory about roby and money.", "2025-03-01")
    return owner, roby, ana


def _letter(client, h, opens: date, **extra):
    body = {"title": "Greet", "text": "hi roby", "entry_date": today().isoformat(), "kind": "letter",
            "recipient": "roby", "release_on": opens.isoformat(), "release_on_death": False,
            "deliver_while_alive": True, **extra}
    return client.post("/api/entries", headers=h, json=body)


def test_a_letter_for_today_is_delivered_at_once(client, db, smtp):
    owner, roby, ana = _setup(db)
    r = _letter(client, login(client, owner.email), today())
    assert r.status_code == 201, r.text
    assert r.json()["delivery"]["status"] == "delivered" and r.json()["delivery"]["email"] == "sent"
    msg = FakeSMTP.sent[-1]
    assert msg["To"] == roby.email and "A letter from Kean Gito" in msg["Subject"]
    assert "hi roby" not in msg.get_content()  # the email points to MMK; the letter itself stays there

    hr = login(client, roby.email)
    letters = client.get("/api/letters", headers=hr).json()
    assert [x["text"] for x in letters] == ["hi roby"]
    ov = client.get("/api/beneficiary/overview", headers=hr).json()
    assert ov["released_letters"] == 1 and ov["shared_entries"] == 0  # diary entries stay closed

    assert client.get("/api/letters", headers=login(client, ana.email)).json() == []
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0  # emailed once only


def test_a_future_letter_waits_for_its_date(client, db, smtp, monkeypatch):
    owner, roby, _ = _setup(db)
    opens = today() + timedelta(days=3)
    r = _letter(client, login(client, owner.email), opens)
    assert r.json()["delivery"] == {"status": "scheduled", "opens_on": opens.isoformat(), "after_death": False,
                                    "days_after_death": None}
    hr = login(client, roby.email)
    assert client.get("/api/letters", headers=hr).json() == []
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0

    monkeypatch.setattr(notify, "today", lambda: opens)
    monkeypatch.setattr("app.routers.assistant.today", lambda: opens)
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 1
    assert FakeSMTP.sent[-1]["To"] == roby.email
    assert [x["text"] for x in client.get("/api/letters", headers=hr).json()] == ["hi roby"]


def test_after_death_letters_still_wait_for_death(client, db, smtp):
    owner, roby, _ = _setup(db)
    h = login(client, owner.email)
    r = client.post("/api/entries", headers=h, json={
        "title": "Later", "text": "for after", "entry_date": today().isoformat(), "kind": "letter",
        "recipient": "roby", "release_on_death": True})
    assert r.status_code == 201 and r.json()["delivery"]["status"] == "scheduled"
    assert client.get("/api/letters", headers=login(client, roby.email)).json() == []
    assert FakeSMTP.sent == []


def test_letter_dates_are_checked(client, db):
    owner, _, _ = _setup(db)
    h = login(client, owner.email)
    r = _letter(client, h, today() - timedelta(days=1))
    assert r.status_code == 422 and "cannot be in the past" in r.text
    r = _letter(client, h, today(), release_on_death=True)
    assert r.status_code == 422 and "not both" in r.text
    r = client.post("/api/entries", headers=h, json={"title": "x", "text": "x", "kind": "letter", "recipient": "roby",
                                                     "entry_date": (today() + timedelta(days=1)).isoformat(),
                                                     "release_on": today().isoformat(), "deliver_while_alive": True})
    assert r.status_code == 422 and "future" in r.text


def test_old_date_only_letters_keep_the_handout_rule(db):
    """Without the new flag, a dated letter still needs the death trigger and a release rule (handout scenario)."""
    owner, roby, _ = _setup(db)
    e = add_entry(db, owner, "Dear Roby", "2025-01-01", kind="letter", recipient_handle="roby",
                  release_on=date(2026, 1, 1), release_on_death=False)
    from app.services import policy_service
    d = policy_service.engine_for(db, owner).decide_all("roby", today())[int(e.id)]
    assert (d.level, d.reason) == ("none", "owner_alive")
