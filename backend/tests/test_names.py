"""First and last names are stored apart; the greeting and emails use the first name."""
from types import SimpleNamespace

from app.models import first_name_of, last_name_of, split_name

from .conftest import register_owner


def test_split_name_for_older_accounts():
    assert split_name("Kean Jayvee Gito") == ("Kean Jayvee", "Gito")
    assert split_name("Elena Ramos") == ("Elena", "Ramos")
    assert split_name("Cher") == ("Cher", "")
    old = SimpleNamespace(display_name="Kean Jayvee Gito")
    assert first_name_of(old) == "Kean Jayvee" and last_name_of(old) == "Gito"


def test_register_with_first_and_last_name(client):
    r = client.post("/api/auth/register", json={"email": "kj@example.com", "first_name": "Kean Jayvee",
                                                "last_name": "Gito", "password": "firstpass1"})
    assert r.status_code == 201, r.text
    v = client.post("/api/auth/verify-email", json={"email": "kj@example.com", "code": r.json()["demo_code"]}).json()
    u = v["user"]
    assert (u["first_name"], u["last_name"], u["display_name"]) == ("Kean Jayvee", "Gito", "Kean Jayvee Gito")


def test_first_name_is_required(client):
    r = client.post("/api/auth/register", json={"email": "x@example.com", "first_name": " ", "last_name": "Gito",
                                                "password": "firstpass1"})
    assert r.status_code == 422


def test_change_names_in_settings(client):
    token = register_owner(client, "rosa@example.com")["token"]
    h = {"Authorization": f"Bearer {token}"}
    r = client.put("/api/settings", headers=h, json={"first_name": "Rosa Mae", "last_name": "Dizon"})
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me", headers=h).json()
    assert (me["first_name"], me["last_name"], me["display_name"]) == ("Rosa Mae", "Dizon", "Rosa Mae Dizon")
