"""Email verification for new owner accounts."""
from datetime import datetime, timedelta, timezone

from app.models import EmailNotice, User

from .conftest import login


def _register(client, email="rosa@example.com", password="rosapass1"):
    r = client.post("/api/auth/register", json={"email": email, "display_name": "Rosa Dizon", "password": password})
    assert r.status_code == 201
    return r.json()


def test_registration_requires_verification_before_use(client, db):
    body = _register(client)
    assert body["verification_required"] is True and "token" not in body
    assert len(body["demo_code"]) == 6 and body["demo_code"].isdigit()
    mail = db.query(EmailNotice).filter_by(kind="verify_email").one()
    assert mail.to_email == "rosa@example.com" and body["demo_code"] in mail.body
    # cannot sign in yet - but only told so after the right password
    r = client.post("/api/auth/login", json={"email": "rosa@example.com", "password": "rosapass1"})
    assert r.status_code == 403 and r.json()["detail"]["verify"] is True
    assert client.post("/api/auth/login", json={"email": "rosa@example.com", "password": "wrongpass1"}).status_code == 401


def test_correct_code_verifies_and_signs_in(client, db):
    code = _register(client)["demo_code"]
    r = client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": code})
    assert r.status_code == 200 and r.json()["token"]
    assert client.post("/api/auth/login", json={"email": "rosa@example.com", "password": "rosapass1"}).status_code == 200
    assert db.query(User).filter_by(email="rosa@example.com").one().email_verified_at


def test_wrong_codes_are_limited(client, db):
    code = _register(client)["demo_code"]
    wrong = "000000" if code != "000000" else "111111"
    for i in range(5):
        r = client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": wrong})
        assert r.status_code == 400
    assert "Too many" in client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": code}).json()["detail"]


def test_expired_code_is_refused(client, db):
    code = _register(client)["demo_code"]
    u = db.query(User).filter_by(email="rosa@example.com").one()
    u.verify_expires_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.commit()
    r = client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": code})
    assert r.status_code == 400 and "expired" in r.json()["detail"]


def test_resend_is_rate_limited_and_replaces_the_code(client, db):
    first = _register(client)["demo_code"]
    assert client.post("/api/auth/resend-verification", json={"email": "rosa@example.com"}).status_code == 429
    u = db.query(User).filter_by(email="rosa@example.com").one()
    u.verify_sent_at = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    db.commit()
    r = client.post("/api/auth/resend-verification", json={"email": "rosa@example.com"})
    second = r.json()["demo_code"]
    if second != first:
        assert client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": first}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": second}).status_code == 200


def test_resend_does_not_reveal_which_emails_exist(client, db):
    a = client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    assert a.status_code == 200 and a.json() == {"ok": True}


def test_unfinished_sign_up_does_not_block_the_real_owner(client, db):
    _register(client, password="impostor1")  # never verified (e.g. a typo or someone else)
    u = db.query(User).filter_by(email="rosa@example.com").one()
    u.verify_sent_at = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    db.commit()
    body = _register(client, password="realowner1")  # the real owner signs up again
    client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": body["demo_code"]})
    assert client.post("/api/auth/login", json={"email": "rosa@example.com", "password": "realowner1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "rosa@example.com", "password": "impostor1"}).status_code == 401
    assert db.query(User).filter_by(email="rosa@example.com").count() == 1


def test_verified_email_cannot_be_registered_again(client, db):
    code = _register(client)["demo_code"]
    client.post("/api/auth/verify-email", json={"email": "rosa@example.com", "code": code})
    r = client.post("/api/auth/register", json={"email": "rosa@example.com", "display_name": "X", "password": "otherpass1"})
    assert r.status_code == 409


def test_code_is_not_shown_when_dev_flag_is_off(client, db, monkeypatch):
    from app.config import settings
    object.__setattr__(settings, "dev_show_verification_code", False)
    try:
        body = _register(client, email="quiet@example.com")
    finally:
        object.__setattr__(settings, "dev_show_verification_code", True)
    assert "demo_code" not in body


def test_existing_accounts_are_treated_as_verified(tmp_path):
    from sqlalchemy import create_engine, text
    from app.db import init_db
    eng = create_engine(f"sqlite:///{tmp_path}/old.db")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, role VARCHAR(20), email VARCHAR(255), created_at VARCHAR(40))"))
        c.execute(text("INSERT INTO users VALUES (1, 'owner', 'old@example.com', '2025-01-01T00:00:00+00:00')"))
    init_db(eng)
    with eng.begin() as c:
        assert c.execute(text("SELECT email_verified_at FROM users")).scalar() == "2025-01-01T00:00:00+00:00"
