"""Executor reports the owner's passing; the death trigger activates after a waiting period
unless the owner cancels ("I'm still here")."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models import DeathReport, EmailNotice
from app.prolog.engine import swipl_available

from .conftest import PASSWORD, add_entry, login, make_beneficiary, make_owner, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")
PHRASE = "REPORT PASSING"


@pytest.fixture()
def fam(db, client):
    owner = make_owner(db, "ana@example.com", "Ana Villanueva")
    carla = make_beneficiary(db, owner, "carla", "Carla Villanueva")
    ben = make_beneficiary(db, owner, "ben", "Ben Villanueva")
    add_entry(db, owner, "A quiet afternoon with the family.", "2020-01-01")
    set_policy(db, owner, "allow carla verbatim access to entries after death;")
    r = client.put("/api/settings/executor", headers=login(client, owner.email), json={"beneficiary_id": carla.id})
    assert r.status_code == 200 and r.json()["executor"]["display_name"] == "Carla Villanueva"
    return {"owner": owner, "carla": carla, "ben": ben}


def _report(client, user, password=PASSWORD, phrase=PHRASE):
    return client.post("/api/executor/report", headers=login(client, user.email),
                       json={"password": password, "confirmation": phrase})


def _make_due(db):
    rep = db.query(DeathReport).filter_by(status="pending").one()
    rep.activates_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.commit()


def test_only_the_executor_can_report(client, db, fam):
    assert _report(client, fam["ben"]).status_code == 403
    assert _report(client, fam["carla"], password="wrong-pass1").status_code == 400
    assert _report(client, fam["carla"], phrase="yes").status_code == 400
    assert client.post("/api/executor/report", json={"password": PASSWORD, "confirmation": PHRASE}).status_code == 401


def test_report_waits_and_emails_the_owner(client, db, fam):
    r = _report(client, fam["carla"])
    assert r.status_code == 200 and r.json()["report"]["status"] == "pending"
    db.refresh(fam["owner"])
    assert fam["owner"].death_triggered_at is None  # nothing happens yet
    mail = db.query(EmailNotice).filter_by(kind="report_to_owner").one()
    assert mail.to_email == fam["owner"].email and "I'm still here" in mail.body
    me = client.get("/api/auth/me", headers=login(client, fam["owner"].email)).json()
    assert me["pending_report"]["reported_by"] == "Carla Villanueva"
    assert _report(client, fam["carla"]).status_code == 400  # no second report while one is waiting


def test_owner_cancels_with_im_still_here(client, db, fam):
    _report(client, fam["carla"])
    h = login(client, fam["owner"].email)
    assert client.post("/api/settings/death-report/cancel", headers=h).json()["pending_report"] is None
    _make_due_or_none = db.query(DeathReport).filter_by(status="pending").count()
    assert _make_due_or_none == 0
    db.refresh(fam["owner"])
    assert fam["owner"].death_triggered_at is None
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert {"death.reported", "death.report_cancelled"} <= set(actions)


def test_executor_can_withdraw(client, db, fam):
    _report(client, fam["carla"])
    r = client.post("/api/executor/withdraw", headers=login(client, fam["carla"].email))
    assert r.status_code == 200 and r.json()["report"] is None
    assert db.query(DeathReport).one().status == "withdrawn"


def test_trigger_activates_after_waiting_period(client, db, fam):
    _report(client, fam["carla"])
    _make_due(db)
    # any signed-in request processes due reports
    client.get("/api/auth/me", headers=login(client, fam["ben"].email))
    db.expire_all()
    owner = db.get(type(fam["owner"]), fam["owner"].id)
    assert owner.death_triggered_at is not None
    assert db.query(DeathReport).one().status == "activated"
    # the vault is sealed, the policy frozen, and Carla now has access and an email notice
    h = login(client, owner.email)
    assert client.put("/api/policy", headers=h, json={"source": "# change"}).status_code == 403
    assert client.post("/api/entries", headers=h, json={"text": "x", "entry_date": "2026-01-01"}).status_code == 403
    assert db.query(EmailNotice).filter_by(kind="death_notice", to_email=fam["carla"].email).count() == 1
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert "death.trigger" in actions


def test_cancelled_report_never_activates(client, db, fam):
    _report(client, fam["carla"])
    _make_due(db)
    rep = db.query(DeathReport).one()
    rep.status = "cancelled"
    db.commit()
    client.get("/api/auth/me", headers=login(client, fam["carla"].email))
    db.refresh(fam["owner"])
    assert fam["owner"].death_triggered_at is None


def test_executor_must_be_own_activated_beneficiary(client, db, fam):
    h = login(client, fam["owner"].email)
    other = make_owner(db, "x@example.com", "X")
    stranger = make_beneficiary(db, other, "zed")
    assert client.put("/api/settings/executor", headers=h, json={"beneficiary_id": stranger.id}).status_code == 404
    fam["ben"].password_hash = None
    db.commit()
    assert client.put("/api/settings/executor", headers=h, json={"beneficiary_id": fam["ben"].id}).status_code == 400
    assert client.put("/api/settings/executor", headers=h, json={"beneficiary_id": None}).json()["executor"] is None


def test_no_reports_after_the_vault_is_sealed(client, db, fam):
    client.post("/api/settings/death-trigger", headers=login(client, fam["owner"].email),
                json={"password": PASSWORD, "confirmation": "SEAL MY VAULT"})
    assert _report(client, fam["carla"]).status_code == 400
