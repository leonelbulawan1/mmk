"""Shared fixtures.  Every test session uses a fresh temporary SQLite database
and fictional people only."""
from __future__ import annotations

import os
import tempfile
from datetime import date

_TMP = tempfile.mkdtemp(prefix="alaala_test_")
# Set TEST_DATABASE_URL (e.g. a PostgreSQL URL) to run the whole suite against another database.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_TMP}/test.db"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-use-0123456789"
os.environ["LLM_PROVIDER"] = "offline"
os.environ["DEV_SHOW_VERIFICATION_CODE"] = "true"  # tests read the code from the response

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine, init_db, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security_hashing import hash_password  # noqa: E402
from app.services import policy_service, vault_service  # noqa: E402

PASSWORD = "testpass123"


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)  # on PostgreSQL this also drops the tables' triggers
    if engine.dialect.name == "sqlite":
        with engine.begin() as conn:  # drop leftover triggers from a previous test
            for (name,) in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall():
                conn.exec_driver_sql(f"DROP TRIGGER IF EXISTS {name}")
    init_db()
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client(db):
    with TestClient(app) as c:
        yield c


def make_owner(db, email="owner@example.com", name="Test Owner") -> User:
    u = User(role="owner", email=email, display_name=name, password_hash=hash_password(PASSWORD),
             email_verified_at="2026-01-01T00:00:00+00:00")
    db.add(u)
    db.commit()
    return u


def make_beneficiary(db, owner: User, handle: str, name: str | None = None, active: bool = True) -> User:
    u = User(role="beneficiary", email=f"{handle}.{owner.id}@example.com", display_name=name or handle.title(),
             owner_id=owner.id, handle=handle, password_hash=hash_password(PASSWORD), active=active,
             email_verified_at="2026-01-01T00:00:00+00:00")
    db.add(u)
    db.commit()
    return u


def add_entry(db, owner, text, d, mode="verbatim", title="", **kw):
    entry, _ = vault_service.create_entry(db, owner, title=title, text=text, entry_date=date.fromisoformat(d),
                                          mode_key=mode, **kw)
    return entry


@pytest.fixture()
def family(db):
    """A fictional owner (Ana) with three beneficiaries and a small diary."""
    owner = make_owner(db, "ana@example.com", "Ana Villanueva")
    bens = {h: make_beneficiary(db, owner, h) for h in ("carla", "ben", "dina")}
    e = {
        "family": add_entry(db, owner, "We had a family picnic by the river. Carla brought mangoes.", "2018-03-10",
                            title="Picnic"),
        "health": add_entry(db, owner, "The doctor confirmed the diagnosis today. I am frightened but calm.",
                            "2019-07-01", title="Diagnosis"),
        "money": add_entry(db, owner, "I secretly paid off the bank loan with my savings this week.", "2020-01-15",
                           title="Loan"),
        "work": add_entry(db, owner, "My project at the office finally launched after two long years. Nobody knows I almost quit in March.",
                          "2021-05-20", title="Launch"),
        "letter": add_entry(db, owner, "Dear Carla, this letter is for you when I am gone. Be brave.", "2022-01-01",
                            title="For Carla", kind="letter", recipient_handle="carla", release_on=None,
                            release_on_death=True),
    }
    return {"owner": owner, "bens": bens, "entries": e}


def set_policy(db, owner, source):
    result, row = policy_service.save_policy(db, owner, source)
    assert result.ok, result.errors
    return row


def register_owner(client, email, name="Rosa Dizon", password="firstpass1") -> dict:
    """Register through the API and verify the email with the (development) code. Returns the
    verify response: token and user."""
    r = client.post("/api/auth/register", json={"email": email, "display_name": name, "password": password})
    assert r.status_code == 201, r.text
    v = client.post("/api/auth/verify-email", json={"email": email, "code": r.json()["demo_code"]})
    assert v.status_code == 200, v.text
    return v.json()


def login(client, email, password=PASSWORD) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(autouse=True)
def _fresh_attempt_limits():
    from app.services import attempts
    from app.services import death

    attempts.reset_all()
    death._LAST_REQUEST_CHECK[0] = 0.0
    yield
