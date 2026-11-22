"""Email addresses are checked before an invitation is sent, and a bounce (no such mailbox) is reported."""
import httpx
import pytest

from app.config import settings
from app.models import EmailNotice
from app.services import email_check, notify
from app.services.email_check import InvalidEmail, check_address

from .conftest import login, make_owner


@pytest.fixture(autouse=True)
def _no_dns(monkeypatch):
    """The test machine has no DNS; each test says what the lookup should answer."""
    email_check._has_mx.cache_clear()
    monkeypatch.setattr(email_check, "_has_mx", lambda domain: None)


@pytest.mark.parametrize("addr", ["maria.santos@gmail.com", "Maria.Santos+mmk@Gmail.com", "ana@up.edu.ph",
                                  "jose123@yahoo.com", "someone@outlook.com"])
def test_good_addresses_pass(addr):
    assert check_address(addr) == addr.strip().lower()


@pytest.mark.parametrize("addr, guess", [("maria@gmial.com", "maria@gmail.com"), ("maria@gmail.con", "maria@gmail.com"),
                                         ("jose@yaho.com", "jose@yahoo.com"), ("ana@hotmial.com", "ana@hotmail.com")])
def test_typos_in_common_domains_get_a_suggestion(addr, guess):
    with pytest.raises(InvalidEmail, match=f"Did you mean {guess}"):
        check_address(addr)


@pytest.mark.parametrize("addr", ["abc@gmail.com", "maria..santos@gmail.com", ".maria@gmail.com",
                                  "maria_santos@gmail.com", "a" * 31 + "@gmail.com"])
def test_impossible_gmail_usernames_are_rejected(addr):
    with pytest.raises(InvalidEmail, match="not a valid Gmail address"):
        check_address(addr)


def test_a_domain_without_mail_servers_is_rejected(monkeypatch):
    monkeypatch.setattr(email_check, "_has_mx", lambda domain: False)
    with pytest.raises(InvalidEmail, match="does not exist"):
        check_address("maria@no-such-domain-mmk.ph")


def test_when_dns_is_unavailable_nothing_is_blocked():
    assert check_address("maria@small-school.edu.ph") == "maria@small-school.edu.ph"


def _add(client, h, email, handle="maria"):
    return client.post("/api/beneficiaries", headers=h,
                       json={"display_name": "Maria Santos", "email": email, "handle": handle})


def test_the_add_form_explains_a_bad_or_taken_address(client, db):
    owner = make_owner(db, "juan.check@example.com", "Juan Santos")
    h = login(client, owner.email)
    r = _add(client, h, "maria.santos@gmial.com")
    assert r.status_code == 422 and "Did you mean maria.santos@gmail.com" in r.json()["detail"]
    r = _add(client, h, "abc@gmail.com")
    assert r.status_code == 422 and "not a valid Gmail address" in r.json()["detail"]
    assert _add(client, h, "maria.santos@gmail.com").status_code == 201
    r = _add(client, h, "Maria.Santos@gmail.com", handle="maria2")
    assert r.status_code == 409 and "already registered" in r.json()["detail"]
    r = _add(client, h, owner.email, handle="maria3")
    assert r.status_code == 409


class _Resp:
    def __init__(self, code, text):
        self.status_code, self.text = code, text

    def json(self):
        import json
        return json.loads(self.text)


def test_a_bounced_invitation_shows_and_the_email_can_be_fixed(client, db, monkeypatch):
    saved = {k: getattr(settings, k) for k in ("brevo_api_key", "smtp_host", "smtp_from")}
    try:
        _bounce_flow(client, db, monkeypatch)
    finally:
        for k, v in saved.items():
            object.__setattr__(settings, k, v)


def _bounce_flow(client, db, monkeypatch):
    object.__setattr__(settings, "brevo_api_key", "test-key")
    object.__setattr__(settings, "smtp_host", "")
    object.__setattr__(settings, "smtp_from", "MMK <mmk@example.com>")
    ids = iter(["<m1@brevo>", "<m2@brevo>"])
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(201, '{"messageId":"%s"}' % next(ids)))
    events = {"<m1@brevo>": [{"event": "requests"}, {"event": "hardBounces", "reason": "550 5.1.1 user unknown"}],
              "<m2@brevo>": [{"event": "requests"}, {"event": "delivered"}]}
    monkeypatch.setattr(httpx, "get", lambda url, params, headers, timeout:
                        _Resp(200, __import__("json").dumps({"events": events[params["messageId"]]})))
    monkeypatch.setattr(notify, "_LAST_DELIVERY_CHECK", {})

    owner = make_owner(db, "juan.bounce@example.com", "Juan Santos")
    h = login(client, owner.email)
    r = _add(client, h, "maria.wrongname@gmail.com")
    assert r.status_code == 201 and r.json()["invitation"]["status"] == "sent"
    bid = r.json()["beneficiary"]["id"]

    row = client.get("/api/beneficiaries", headers=h).json()[0]
    assert row["invitation"]["status"] == "bounced" and "user unknown" in row["invitation"]["error"]

    fixed = client.patch(f"/api/beneficiaries/{bid}", headers=h, json={"email": "maria.santos@gmail.com"})
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["email"] == "maria.santos@gmail.com" and fixed.json()["invite_code"]
    monkeypatch.setattr(notify, "_LAST_DELIVERY_CHECK", {})
    assert client.get(f"/api/beneficiaries/{bid}/invitation", headers=h).json()["status"] == "delivered"
    sent = db.query(EmailNotice).filter(EmailNotice.kind == "invitation").order_by(EmailNotice.id).all()
    assert [n.to_email for n in sent] == ["maria.wrongname@gmail.com", "maria.santos@gmail.com"]


def test_sign_up_checks_the_address_and_explains_a_failed_send(client, db, monkeypatch):
    r = client.post("/api/auth/register", json={"display_name": "Ana Cruz", "email": "ana.cruz@gmial.com",
                                                "password": "firstpass1"})
    assert r.status_code == 422 and "Did you mean ana.cruz@gmail.com" in r.json()["detail"]

    saved = {k: getattr(settings, k) for k in ("brevo_api_key", "smtp_host", "smtp_from")}
    try:
        object.__setattr__(settings, "brevo_api_key", "test-key")
        object.__setattr__(settings, "smtp_host", "")
        object.__setattr__(settings, "smtp_from", "MMK <mmk@example.com>")
        monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(
            401, '{"code":"unauthorized","message":"We have detected you are using an unrecognised IP address 1.2.3.4"}'))
        r = client.post("/api/auth/register", json={"display_name": "Ana Cruz", "email": "ana.cruz@gmail.com",
                                                    "password": "firstpass1"})
        assert r.status_code == 201
        assert r.json()["email_sent"] is False and "Authorised IPs" in r.json()["email_problem"]
        # Nothing reached the inbox, so asking again right away is allowed (no 60-second wait).
        monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(201, '{"messageId":"<v1@brevo>"}'))
        again = client.post("/api/auth/resend-verification", json={"email": "ana.cruz@gmail.com"})
        assert again.status_code == 200 and again.json()["email_sent"] is True and again.json()["email_problem"] == ""
    finally:
        for k, v in saved.items():
            object.__setattr__(settings, k, v)
