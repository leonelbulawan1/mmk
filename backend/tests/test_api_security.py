"""Authentication, role-based access, unauthorised beneficiaries, sealing."""
from app.security_hashing import hash_password, verify_password

from .conftest import PASSWORD, add_entry, login, make_beneficiary, make_owner, register_owner, set_policy


def test_password_hashing():
    h = hash_password("correct horse 1")
    assert h.startswith("scrypt$") and "correct horse" not in h
    assert verify_password("correct horse 1", h) and not verify_password("wrong", h)
    assert hash_password("correct horse 1") != h  # salted


def test_register_login_me(client):
    body = register_owner(client, "new@example.com", "New Owner", "goodpass1")
    h = {"Authorization": f"Bearer {body['token']}"}
    assert client.get("/api/auth/me", headers=h).json()["role"] == "owner"
    assert client.post("/api/auth/register", json={"email": "new@example.com", "display_name": "x",
                                                   "password": "goodpass1"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "nope1234"}).status_code == 401


def test_weak_password_rejected(client):
    r = client.post("/api/auth/register", json={"email": "w@example.com", "display_name": "W", "password": "password"})
    assert r.status_code == 422


def test_endpoints_require_authentication(client):
    for path in ("/api/entries", "/api/policy", "/api/beneficiaries", "/api/vault/verify", "/api/letters",
                 "/api/access/matrix", "/api/dashboard"):
        assert client.get(path).status_code == 401, path
    assert client.get("/api/entries", headers={"Authorization": "Bearer forged.token.value"}).status_code == 401


def test_beneficiary_cannot_use_owner_endpoints(client, db):
    owner = make_owner(db)
    make_beneficiary(db, owner, "carla")
    h = login(client, "carla.%d@example.com" % owner.id)
    for path in ("/api/entries", "/api/policy", "/api/beneficiaries", "/api/vault/verify", "/api/access/matrix"):
        assert client.get(path, headers=h).status_code == 403, path
    assert client.post("/api/entries", headers=h, json={"text": "x", "entry_date": "2020-01-01"}).status_code == 403


def test_owner_isolation(client, db):
    a = make_owner(db, "a@example.com", "A")
    b = make_owner(db, "b@example.com", "B")
    e = add_entry(db, a, "A's secret.", "2020-01-01")
    hb = login(client, b.email)
    assert client.get(f"/api/entries/{e.id}", headers=hb).status_code == 404
    assert client.get("/api/entries", headers=hb).json() == []


def test_owner_cannot_preview_as_someone_elses_beneficiary(client, db):
    a = make_owner(db, "a@example.com", "A")
    b = make_owner(db, "b@example.com", "B")
    make_beneficiary(db, b, "zed")
    r = client.post("/api/assistant/ask", headers=login(client, a.email), json={"question": "hi", "as_handle": "zed"})
    assert r.status_code == 404


def test_invite_activation_flow(client, db):
    owner = make_owner(db)
    h = login(client, owner.email)
    r = client.post("/api/beneficiaries", headers=h, json={"display_name": "Paolo Reyes", "email": "paolo@example.com",
                                                           "handle": "paolo", "relationship": "Nephew"})
    assert r.status_code == 201
    code = r.json()["invite_code"]
    assert r.json()["invite_link"].endswith(f"/activate?email=paolo%40example.com&code={code}")
    assert client.post("/api/auth/login", json={"email": "paolo@example.com", "password": "whatever1"}).status_code == 401
    bad = client.post("/api/auth/activate", json={"email": "paolo@example.com", "invite_code": "AAAA-BBBB-CCCC",
                                                  "password": "newpass12"})
    assert bad.status_code == 400
    ok = client.post("/api/auth/activate", json={"email": "paolo@example.com", "invite_code": code,
                                                 "password": "newpass12"})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "beneficiary"
    # invite codes are single-use
    again = client.post("/api/auth/activate", json={"email": "paolo@example.com", "invite_code": code,
                                                    "password": "newpass12"})
    assert again.status_code == 400


def test_handle_validation(client, db):
    owner = make_owner(db)
    h = login(client, owner.email)
    for handle in ("everyone", "Bad Handle", "x"):
        r = client.post("/api/beneficiaries", headers=h, json={"display_name": "X", "email": f"{len(handle)}@ex.com",
                                                               "handle": handle})
        assert r.status_code == 422, handle


def test_deactivated_beneficiary_is_locked_out(client, db):
    owner = make_owner(db)
    ben = make_beneficiary(db, owner, "carla")
    h = login(client, ben.email)
    hb = login(client, owner.email)
    assert client.patch(f"/api/beneficiaries/{ben.id}", headers=hb, json={"active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401  # existing token no longer works
    assert client.post("/api/auth/login", json={"email": ben.email, "password": PASSWORD}).status_code == 401


def test_unauthorised_beneficiary_gets_neutral_answer(client, db):
    owner = make_owner(db)
    add_entry(db, owner, "I buried the family treasure under the mango tree.", "2020-01-01")
    make_beneficiary(db, owner, "carla")
    ben = make_beneficiary(db, owner, "ben")
    set_policy(db, owner, "allow carla verbatim access to entries;")
    r = client.post("/api/assistant/ask", headers=login(client, ben.email), json={"question": "Where is the treasure?"})
    assert r.status_code == 200
    body = r.json()
    assert "mango" not in body["answer"].lower() and body["citations"] == []
    assert client.get("/api/letters", headers=login(client, ben.email)).json() == []


def test_death_trigger_requires_password_and_phrase_and_seals(client, db):
    owner = make_owner(db)
    h = login(client, owner.email)
    assert client.post("/api/settings/death-trigger", headers=h,
                       json={"password": "wrong-pass1", "confirmation": "SEAL MY VAULT"}).status_code == 400
    assert client.post("/api/settings/death-trigger", headers=h,
                       json={"password": PASSWORD, "confirmation": "yes"}).status_code == 400
    assert client.post("/api/settings/death-trigger", headers=h,
                       json={"password": PASSWORD, "confirmation": "SEAL MY VAULT"}).status_code == 200
    assert client.post("/api/entries", headers=h, json={"text": "after", "entry_date": "2026-01-01"}).status_code == 403
    assert client.post("/api/settings/death-trigger", headers=h,
                       json={"password": PASSWORD, "confirmation": "SEAL MY VAULT"}).status_code == 403
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert "death.trigger" in actions


def test_audit_log_records_access(client, db):
    owner = make_owner(db)
    ben = make_beneficiary(db, owner, "carla")
    add_entry(db, owner, "A note.", "2020-01-01")
    set_policy(db, owner, "allow carla summary access to entries;")
    client.post("/api/assistant/ask", headers=login(client, ben.email), json={"question": "note"})
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=login(client, owner.email)).json()]
    assert {"assistant.ask", "policy.save", "entry.create", "auth.login"} <= set(actions)


def test_remember_me_issues_longer_session(client, db):
    import jwt as pyjwt
    owner = make_owner(db)
    short = client.post("/api/auth/login", json={"email": owner.email, "password": PASSWORD}).json()["token"]
    long = client.post("/api/auth/login", json={"email": owner.email, "password": PASSWORD, "remember": True}).json()["token"]
    ttl = lambda t: (lambda p: p["exp"] - p["iat"])(pyjwt.decode(t, options={"verify_signature": False}))
    assert ttl(short) == 8 * 3600
    assert ttl(long) == 30 * 24 * 3600
