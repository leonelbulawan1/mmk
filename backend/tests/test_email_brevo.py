"""Email through Brevo's HTTPS API (for hosts that block SMTP ports). The API call is faked."""
import httpx

from app.config import settings
from app.models import EmailNotice
from app.services import notify
import pytest


@pytest.fixture(autouse=True)
def _restore_settings():
    saved = {k: getattr(settings, k) for k in ("brevo_api_key", "smtp_host", "smtp_from")}
    yield
    for k, v in saved.items():
        object.__setattr__(settings, k, v)


def _set(name, value):
    object.__setattr__(settings, name, value)


class _Resp:
    def __init__(self, code, text=""):
        self.status_code, self.text = code, text


def _notice():
    return EmailNotice(to_email="ana@example.com", subject="Your MMK code", body="Code: 123456",
                       kind="verify_email", status="queued")


def test_brevo_used_when_key_set(monkeypatch):
    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(url=url, headers=headers, json=json)
        return _Resp(201, '{"messageId":"x"}')

    _set("brevo_api_key", "test-key")
    _set("smtp_host", "")
    _set("smtp_from", "MMK <mmk@example.com>")
    monkeypatch.setattr(httpx, "post", fake_post)
    assert notify.smtp_configured()
    n = _notice()
    notify._send(n)
    assert n.status == "sent" and n.sent_at
    assert n.provider_id == "x"
    assert sent["url"].endswith("/v3/smtp/email")
    assert sent["headers"]["api-key"] == "test-key"
    assert sent["json"]["sender"] == {"name": "MMK", "email": "mmk@example.com"}
    assert sent["json"]["to"] == [{"email": "ana@example.com"}]
    assert sent["json"]["textContent"] == "Code: 123456"


def test_brevo_error_marks_failed(monkeypatch):
    _set("brevo_api_key", "bad-key")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(401, '{"message":"Key not found"}'))
    n = _notice()
    notify._send(n)
    assert n.status == "failed" and "401" in n.error


def test_not_configured_without_key_or_smtp(monkeypatch):
    _set("brevo_api_key", "")
    _set("smtp_host", "")
    n = _notice()
    notify._send(n)
    assert n.status == "not_configured" and "BREVO_API_KEY" in n.error


class _JResp(_Resp):
    def json(self):
        import json
        return json.loads(self.text)


def test_gmail_relay_is_preferred_and_sends_text_and_html(monkeypatch):
    saved = {k: getattr(settings, k) for k in ("gmail_relay_url", "gmail_relay_secret")}
    sent = {}

    def fake_post(url, **kw):
        sent.update(url=url, **kw)
        return _JResp(200, '{"ok": true}')

    try:
        _set("gmail_relay_url", "https://script.google.com/macros/s/abc/exec")
        _set("gmail_relay_secret", "s3cret")
        _set("brevo_api_key", "test-key")
        monkeypatch.setattr(httpx, "post", fake_post)
        n = _notice()
        n.body = "Open https://mmk-web.onrender.com/activate?code=1 to start."
        notify._send(n)
        assert n.status == "sent" and sent["url"].endswith("/exec") and sent["follow_redirects"] is True
        assert sent["json"]["secret"] == "s3cret" and sent["json"]["to"] == "ana@example.com"
        assert '<a href="https://mmk-web.onrender.com/activate?code=1">' in sent["json"]["html"]
        monkeypatch.setattr(httpx, "post", lambda url, **kw: _JResp(200, '{"ok": false, "error": "wrong secret"}'))
        n = _notice()
        notify._send(n)
        assert n.status == "failed" and "GMAIL_RELAY_SECRET" in notify.email_problem(n)
    finally:
        for k, v in saved.items():
            _set(k, v)
