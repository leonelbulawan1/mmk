"""Automatic email notices to beneficiaries when the death trigger is activated."""
import smtplib

import pytest

from app.config import settings
from app.models import EmailNotice
from app.prolog.engine import swipl_available

from .conftest import PASSWORD, add_entry, login, make_beneficiary, make_owner, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")

SECRET_ENTRY = "I buried the family heirloom under the old mango tree."
SECRET_LETTER = "Dear Carla, the key to the cabinet is taped under the piano."


@pytest.fixture()
def vault(db):
    owner = make_owner(db, "ana@example.com", "Ana Villanueva")
    carla = make_beneficiary(db, owner, "carla", "Carla Villanueva")
    ben = make_beneficiary(db, owner, "ben", "Ben Villanueva")
    dina = make_beneficiary(db, owner, "dina", "Dina Cruz")
    dina.password_hash = None  # invited but never activated
    db.commit()
    add_entry(db, owner, SECRET_ENTRY, "2020-01-01", title="Heirloom")
    add_entry(db, owner, SECRET_LETTER, "2021-01-01", title="For Carla", kind="letter", recipient_handle="carla",
              release_on=None, release_on_death=True)
    set_policy(db, owner, """
        allow carla verbatim access to entries after death;
        allow dina summary access to entries after death;
        release letters to carla after death;""")  # Ben gets nothing
    return {"owner": owner, "carla": carla, "ben": ben, "dina": dina}


def _trigger(client, owner):
    r = client.post("/api/settings/death-trigger", headers=login(client, owner.email),
                    json={"password": PASSWORD, "confirmation": "SEAL MY VAULT"})
    assert r.status_code == 200
    return r.json()


class FakeSMTP:
    sent: list = []

    def __init__(self, host, port, timeout=None):
        self.host = host

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        pass

    def login(self, u, p):
        pass

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp(monkeypatch):
    FakeSMTP.sent = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(type(settings), "smtp_host", "smtp.example.com", raising=False)
    object.__setattr__(settings, "smtp_host", "smtp.example.com")
    yield FakeSMTP
    object.__setattr__(settings, "smtp_host", "")


def test_trigger_emails_only_beneficiaries_with_something_available(client, db, vault, smtp):
    body = _trigger(client, vault["owner"])
    to = sorted(n["to_email"] for n in body["notices"])
    assert to == sorted([vault["carla"].email, vault["dina"].email])  # not Ben: nothing released to him
    assert body["emails_sent"] == 2 and {n["status"] for n in body["notices"]} == {"sent"}
    assert sorted(m["To"] for m in smtp.sent) == to


def test_emails_never_contain_diary_content(client, db, vault, smtp):
    _trigger(client, vault["owner"])
    for msg in smtp.sent:
        text = msg.get_content()
        assert "heirloom" not in text.lower() and "piano" not in text.lower() and "mango" not in text.lower()
        assert "no part of the diary is included" in text
    carla_mail = next(m for m in smtp.sent if m["To"] == vault["carla"].email).get_content()
    assert "1 letter written for you" in carla_mail and "1 diary entry shared with you" in carla_mail
    assert "/login" in carla_mail


def test_unactivated_beneficiary_gets_a_working_invite_code(client, db, vault, smtp):
    _trigger(client, vault["owner"])
    dina_mail = next(m for m in smtp.sent if m["To"] == vault["dina"].email).get_content()
    code = next(line.strip() for line in dina_mail.splitlines() if line.strip().count("-") == 2 and len(line.strip()) == 14)
    assert f"/activate?email={vault['dina'].email.replace('@', '%40')}&code={code}" in dina_mail  # one-click link
    r = client.post("/api/auth/activate", json={"email": vault["dina"].email, "invite_code": code, "password": "dinapass1"})
    assert r.status_code == 200


def test_without_smtp_notices_are_kept_and_can_be_retried(client, db, vault, monkeypatch):
    body = _trigger(client, vault["owner"])
    assert body["email_configured"] is False
    assert {n["status"] for n in body["notices"]} == {"not_configured"}
    h = login(client, vault["owner"].email)
    listed = client.get("/api/settings/notifications", headers=h).json()["notices"]
    assert len(listed) == 2
    # once email is configured, a retry sends it
    FakeSMTP.sent = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    object.__setattr__(settings, "smtp_host", "smtp.example.com")
    try:
        r = client.post(f"/api/settings/notifications/{listed[0]['id']}/retry", headers=h)
        assert r.status_code == 200 and r.json()["notices"][0]["status"] == "sent"
    finally:
        object.__setattr__(settings, "smtp_host", "")


def test_smtp_failure_does_not_undo_the_trigger(client, db, vault, monkeypatch):
    class Broken(FakeSMTP):
        def send_message(self, msg):
            raise smtplib.SMTPException("mail server down")
    monkeypatch.setattr(smtplib, "SMTP", Broken)
    object.__setattr__(settings, "smtp_host", "smtp.example.com")
    try:
        body = _trigger(client, vault["owner"])
    finally:
        object.__setattr__(settings, "smtp_host", "")
    assert body["death_triggered_at"]
    assert {n["status"] for n in body["notices"]} == {"failed"}
    assert "mail server down" in body["notices"][0]["error"]


def test_notices_are_audited_and_owner_scoped(client, db, vault):
    _trigger(client, vault["owner"])
    h = login(client, vault["owner"].email)
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert "notify.not_configured" in actions
    other = make_owner(db, "other@example.com", "Other")
    nid = db.query(EmailNotice).first().id
    assert client.post(f"/api/settings/notifications/{nid}/retry", headers=login(client, other.email)).status_code == 404
    assert client.get("/api/settings/notifications", headers=login(client, vault["carla"].email)).status_code == 403
