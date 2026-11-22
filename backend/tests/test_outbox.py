"""The email outbox: temporary failures are retried with growing waits, permanent ones are not, a stopped send
is flagged instead of resent, a letter is never emailed twice, and test mode never emails real people."""
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.config import settings
from app.models import EmailNotice
from app.services import notify

from .conftest import make_beneficiary, make_owner


class _Resp:
    def __init__(self, code, text="{}"):
        self.status_code, self.text = code, text


@pytest.fixture()
def brevo(monkeypatch):
    saved = {k: getattr(settings, k) for k in ("brevo_api_key", "smtp_host", "smtp_from", "gmail_relay_url",
                                               "email_mode", "email_allowlist")}
    for k, v in {"brevo_api_key": "k", "smtp_host": "", "smtp_from": "MMK <mmk@example.com>", "gmail_relay_url": "",
                 "email_mode": "live", "email_allowlist": ""}.items():
        object.__setattr__(settings, k, v)
    calls = []

    def answer(code):
        def post(*a, **kw):
            calls.append(kw.get("json", {}).get("to"))
            return _Resp(code, '{"messageId":"<m@x>"}' if code < 300 else '{"message":"x"}')
        monkeypatch.setattr(httpx, "post", post)
    yield answer, calls
    for k, v in saved.items():
        object.__setattr__(settings, k, v)


def _notice(db, owner, ben, **kw):
    n = EmailNotice(owner_id=owner.id, beneficiary_id=ben.id, to_email=ben.email, subject="Hello", body="Body",
                    kind="invitation", status="queued", error="", attempts=0, **kw)
    db.add(n)
    db.flush()
    return n


def _make_due(db, n):
    n.next_attempt_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    db.commit()


def test_a_temporary_failure_is_retried_later_and_then_sent(db, brevo):
    answer, calls = brevo
    owner = make_owner(db, "o1@example.com"); ben = make_beneficiary(db, owner, "roby")
    answer(503)
    n = _notice(db, owner, ben)
    notify._send(n)
    db.commit()
    assert n.status == "retrying" and n.attempts == 1
    wait = datetime.fromisoformat(n.next_attempt_at) - datetime.now(timezone.utc)
    assert timedelta(seconds=30) < wait <= timedelta(minutes=1)
    assert notify.process_outbox(db) == 0  # not due yet
    _make_due(db, n)
    answer(201)
    assert notify.process_outbox(db) == 1
    db.refresh(n)
    assert n.status == "sent" and n.attempts == 2 and n.next_attempt_at is None


def test_waits_grow_and_the_last_failure_is_final(db, brevo):
    answer, _ = brevo
    owner = make_owner(db, "o2@example.com"); ben = make_beneficiary(db, owner, "roby")
    answer(500)
    n = _notice(db, owner, ben)
    notify._send(n); db.commit()
    waits = []
    while n.status == "retrying":
        waits.append(round((datetime.fromisoformat(n.next_attempt_at) - datetime.now(timezone.utc)).total_seconds() / 60))
        _make_due(db, n)
        notify.process_outbox(db)
        db.refresh(n)
    assert waits == [1, 5, 30, 120]
    assert n.status == "failed" and n.attempts == notify.MAX_ATTEMPTS


def test_a_permanent_refusal_is_not_retried(db, brevo):
    answer, _ = brevo
    owner = make_owner(db, "o3@example.com"); ben = make_beneficiary(db, owner, "roby")
    answer(400)
    n = _notice(db, owner, ben)
    notify._send(n)
    assert n.status == "failed" and n.next_attempt_at is None


def test_an_interrupted_send_is_flagged_not_resent(db, brevo):
    answer, calls = brevo
    owner = make_owner(db, "o4@example.com"); ben = make_beneficiary(db, owner, "roby")
    n = _notice(db, owner, ben, )
    n.status = "sending"
    n.next_attempt_at = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    db.commit()
    answer(201)
    notify.process_outbox(db)
    db.refresh(n)
    assert n.status == "unknown" and "may or may not" in n.error and calls == []


def test_only_one_runner_claims_a_due_retry(db, brevo):
    answer, calls = brevo
    owner = make_owner(db, "o5@example.com"); ben = make_beneficiary(db, owner, "roby")
    n = _notice(db, owner, ben)
    n.status = "retrying"; n.attempts = 1
    _make_due(db, n)
    n.status = "sending"  # another runner claimed it first
    db.commit()
    answer(201)
    assert notify.process_outbox(db) == 0 and calls == []


def test_the_same_letter_cannot_be_queued_twice(db):
    owner = make_owner(db, "o6@example.com"); ben = make_beneficiary(db, owner, "roby")
    _notice(db, owner, ben, idempotency_key="letter:1:2")
    db.commit()
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        _notice(db, owner, ben, idempotency_key="letter:1:2")
    db.rollback()


def test_sandbox_mode_only_emails_the_allow_list(db, brevo):
    answer, calls = brevo
    object.__setattr__(settings, "email_mode", "sandbox")
    object.__setattr__(settings, "email_allowlist", "tester@example.com, @team.test")
    owner = make_owner(db, "o7@example.com"); ben = make_beneficiary(db, owner, "roby")
    answer(201)
    real = _notice(db, owner, ben)
    notify._send(real)
    assert real.status == "sandboxed" and calls == [] and "test mode" in notify.email_problem(real)
    ok = _notice(db, owner, ben); ok.to_email = "ana@team.test"
    notify._send(ok)
    assert ok.status == "sent" and calls == [[{"email": "ana@team.test"}]]
