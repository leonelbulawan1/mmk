"""Letters that open a number of days after the death trigger."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.config import today
from app.prolog.engine import swipl_available
from app.services import policy_service

from .conftest import add_entry, login, make_beneficiary, make_owner, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")


def _setup(db):
    owner = make_owner(db, "lola.days@example.com", "Lola Reyes")
    make_beneficiary(db, owner, "nico", "Nico Reyes")
    e = add_entry(db, owner, "Dear Nico, happy first month without me.", "2025-01-01", kind="letter",
                  recipient_handle="nico", release_on=None, release_on_death=True, release_days_after_death=30)
    set_policy(db, owner, "release letters to nico after death;")
    return owner, e


def _decide(db, owner, e, when):
    return policy_service.engine_for(db, owner).decide_all("nico", when)[int(e.id)]


def test_it_opens_only_once_the_days_have_passed_after_death(db):
    owner, e = _setup(db)
    assert _decide(db, owner, e, today()).level == "none"  # alive
    died = datetime.now(timezone.utc) - timedelta(days=10)
    owner.death_triggered_at = died.isoformat()
    db.commit()
    d0 = policy_service.death_date(owner)
    assert _decide(db, owner, e, d0 + timedelta(days=29)).level == "none"
    assert _decide(db, owner, e, d0 + timedelta(days=30)).level == "verbatim"


def test_the_api_checks_the_option(client, db):
    owner = make_owner(db, "lola.api@example.com", "Lola Reyes")
    make_beneficiary(db, owner, "nico", "Nico Reyes")
    h = login(client, owner.email)
    base = {"title": "Later", "text": "Dear Nico", "entry_date": today().isoformat(), "kind": "letter", "recipient": "nico"}
    r = client.post("/api/entries", headers=h, json={**base, "release_on_death": True, "release_days_after_death": 30})
    assert r.status_code == 201
    assert r.json()["entry"]["release_days_after_death"] == 30
    assert r.json()["delivery"] == {"status": "scheduled", "opens_on": None, "after_death": True, "days_after_death": 30}
    r = client.post("/api/entries", headers=h, json={**base, "release_on": today().isoformat(), "deliver_while_alive": True,
                                                     "release_days_after_death": 30})
    assert r.status_code == 422
    r = client.post("/api/entries", headers=h, json={**base, "release_on_death": True, "release_days_after_death": 0})
    assert r.status_code == 422
