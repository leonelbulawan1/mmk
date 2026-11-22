"""Wrong passwords and invite codes are limited, so they cannot be guessed; responses carry security headers."""
from .conftest import PASSWORD, make_beneficiary, make_owner


def _login(client, email, pw, ip="203.0.113.5"):
    return client.post("/api/auth/login", json={"email": email, "password": pw}, headers={"X-Forwarded-For": ip})


def test_five_wrong_passwords_lock_that_email_for_a_while(client, db):
    owner = make_owner(db, "kean.lock@example.com", "Kean Gito")
    for _ in range(5):
        assert _login(client, owner.email, "wrongpass1").status_code == 401
    r = _login(client, owner.email, PASSWORD)  # even the right password waits
    assert r.status_code == 429 and "Too many attempts" in r.json()["detail"]
    other = make_owner(db, "ana.ok@example.com", "Ana Cruz")
    assert _login(client, other.email, PASSWORD).status_code == 200  # other people are not affected


def test_a_correct_sign_in_clears_earlier_mistakes(client, db):
    owner = make_owner(db, "kean.clear@example.com", "Kean Gito")
    for _ in range(4):
        _login(client, owner.email, "wrongpass1")
    assert _login(client, owner.email, PASSWORD).status_code == 200
    for _ in range(4):
        assert _login(client, owner.email, "wrongpass1").status_code == 401


def test_one_address_guessing_many_accounts_is_stopped(client, db):
    for i in range(20):
        _login(client, f"nobody{i}@example.com", "wrongpass1", ip="198.51.100.9")
    owner = make_owner(db, "kean.ip@example.com", "Kean Gito")
    assert _login(client, owner.email, PASSWORD, ip="198.51.100.9").status_code == 429
    assert _login(client, owner.email, PASSWORD, ip="198.51.100.10").status_code == 200


def test_invite_codes_cannot_be_guessed(client, db):
    owner = make_owner(db, "kean.inv@example.com", "Kean Gito")
    ben = make_beneficiary(db, owner, "roby", "Roby Flores")
    body = {"email": ben.email, "invite_code": "AAAA-BBBB-CCCC", "password": "newpass123"}
    for _ in range(5):
        assert client.post("/api/auth/activate", json=body).status_code == 400
    assert client.post("/api/auth/activate", json=body).status_code == 429


def test_api_responses_have_security_headers(client):
    r = client.get("/api/ping")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
