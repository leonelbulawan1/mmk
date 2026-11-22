"""Forgot password: a 6-digit reset code is emailed; resetting signs out every device."""
from datetime import datetime, timedelta, timezone

from app.models import EmailNotice, User

from .conftest import PASSWORD, login, make_beneficiary, make_owner, register_owner


def _forgot(client, email):
    r = client.post("/api/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    return r.json()


def _reset(client, email, code, new_password="newpass123"):
    return client.post("/api/auth/reset-password", json={"email": email, "code": code, "new_password": new_password})


def test_reset_code_is_emailed_and_resets_the_password(client, db):
    owner = make_owner(db)
    body = _forgot(client, owner.email)
    code = body["demo_code"]
    mail = db.query(EmailNotice).filter_by(kind="reset_email").one()
    assert mail.to_email == owner.email and code in mail.body and "password" in mail.subject.lower()
    assert _reset(client, owner.email, code).status_code == 200
    assert client.post("/api/auth/login", json={"email": owner.email, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": owner.email, "password": "newpass123"}).status_code == 200


def test_beneficiaries_reset_by_email_too(client, db):
    owner = make_owner(db)
    ben = make_beneficiary(db, owner, "carla")
    code = _forgot(client, ben.email)["demo_code"]
    assert _reset(client, ben.email, code, "carlanew1").status_code == 200
    assert client.post("/api/auth/login", json={"email": ben.email, "password": "carlanew1"}).status_code == 200


def test_unknown_email_gets_the_same_answer(client, db):
    owner = make_owner(db)
    known = _forgot(client, owner.email)
    unknown = _forgot(client, "nobody@example.com")
    assert unknown == {"ok": True}
    assert set(known) - {"demo_code"} == set(unknown)  # only the development code differs
    assert _reset(client, "nobody@example.com", "123456").json()["detail"] == "That code is not correct"


def test_code_is_single_use_and_limited(client, db):
    owner = make_owner(db)
    code = _forgot(client, owner.email)["demo_code"]
    assert _reset(client, owner.email, code).status_code == 200
    assert _reset(client, owner.email, code, "another12").status_code == 400  # already used
    u = db.query(User).get(owner.id)
    u.reset_sent_at = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    db.commit()
    code = _forgot(client, owner.email)["demo_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert _reset(client, owner.email, wrong).status_code == 400
    assert "Too many" in _reset(client, owner.email, code).json()["detail"]


def test_expired_code_is_refused(client, db):
    owner = make_owner(db)
    code = _forgot(client, owner.email)["demo_code"]
    u = db.query(User).get(owner.id)
    u.reset_expires_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.commit()
    assert "expired" in _reset(client, owner.email, code).json()["detail"]


def test_resend_within_a_minute_sends_nothing_new(client, db):
    owner = make_owner(db)
    first = _forgot(client, owner.email)["demo_code"]
    assert _forgot(client, owner.email) == {"ok": True}  # rate limited, same neutral answer
    assert _reset(client, owner.email, first).status_code == 200


def test_reset_signs_out_every_device(client, db):
    owner = make_owner(db)
    phone, laptop = login(client, owner.email), login(client, owner.email)
    code = _forgot(client, owner.email)["demo_code"]
    _reset(client, owner.email, code)
    assert client.get("/api/auth/me", headers=phone).status_code == 401
    assert client.get("/api/auth/me", headers=laptop).status_code == 401


def test_changing_password_keeps_this_device_and_signs_out_others(client, db):
    owner = make_owner(db)
    other, this = login(client, owner.email), login(client, owner.email)
    r = client.post("/api/auth/change-password", headers=this,
                    json={"current_password": PASSWORD, "new_password": "changed123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=other).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200


def test_reset_rejects_weak_password(client, db):
    owner = make_owner(db)
    code = _forgot(client, owner.email)["demo_code"]
    assert _reset(client, owner.email, code, "onlyletters").status_code == 422


def test_inactive_or_unverified_accounts_cannot_reset(client, db):
    owner = make_owner(db)
    ben = make_beneficiary(db, owner, "carla", active=False)
    assert "demo_code" not in _forgot(client, ben.email)
    r = client.post("/api/auth/register", json={"email": "new@example.com", "display_name": "New", "password": "newpass12"})
    assert r.status_code == 201
    assert "demo_code" not in _forgot(client, "new@example.com")  # must verify the email first


def test_resets_are_audited(client, db):
    owner = make_owner(db)
    code = _forgot(client, owner.email)["demo_code"]
    _reset(client, owner.email, "000000" if code != "000000" else "111111")
    _reset(client, owner.email, code)
    h = login(client, owner.email, "newpass123")
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert {"auth.reset_code_sent", "auth.reset_code_failed", "auth.password_reset"} <= set(actions)


def test_old_database_gets_new_columns(tmp_path):
    """Databases created before these features existed are upgraded in place."""
    from sqlalchemy import create_engine, inspect, text
    from app.db import init_db

    eng = create_engine(f"sqlite:///{tmp_path}/old.db")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, role VARCHAR(20), email VARCHAR(255))"))
    init_db(eng)
    cols = {c["name"] for c in inspect(eng).get_columns("users")}
    assert {"reset_code_hash", "token_version", "email_verified_at", "executor_id"} <= cols
