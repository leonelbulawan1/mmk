"""Typed failures (AccessDenied, AmbiguousName, TamperDetected, PolicySyntaxError) and their safe actions."""
import pytest
from sqlalchemy import select, text

from app.ai.tools import NOT_AVAILABLE, AuthorizedContext
from app.errors import AccessDenied, AlaalaError, AmbiguousName, PolicySyntaxError, TamperDetected
from app.models import AuditRow
from app.prolog.engine import swipl_available

from .conftest import add_entry, login, make_beneficiary, make_owner, set_policy

needs_prolog = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")


def test_exception_hierarchy():
    for exc in (AccessDenied, AmbiguousName, TamperDetected):
        assert issubclass(exc, AlaalaError)
    assert issubclass(AccessDenied, PermissionError)
    assert issubclass(PolicySyntaxError, Exception)


def test_access_denied_looks_exactly_like_a_missing_entry():
    ctx = AuthorizedContext(handle="maria", views={1: {"entry_id": 1, "date": "2020-01-01", "kind": "text", "access": "existence"}})
    with pytest.raises(AccessDenied):
        ctx._view(2)
    assert ctx.get_entry(2) == ctx.get_entry(999) == NOT_AVAILABLE
    assert ctx.call("get_entry", {"entry_id": 2}) == NOT_AVAILABLE


def _released_family(db):
    owner = make_owner(db, "tamper@example.com", "Rosa Dizon")
    maria = make_beneficiary(db, owner, "maria", "Maria Dizon")
    add_entry(db, owner, "Rosa planted mangoes with Maria.", "2020-01-01")
    add_entry(db, owner, "Dear Maria, be brave.", "2021-01-01", kind="letter", recipient_handle="maria",
              release_on_death=True)
    set_policy(db, owner, "allow maria verbatim access to entries;\nrelease letters to maria after death;")
    owner.death_triggered_at = "2026-11-20T00:00:00+00:00"
    db.commit()
    return owner, maria


def _drop_guard(db, table):
    if db.bind.dialect.name == "postgresql":
        db.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER {table}_append_only"))
    else:
        for (name,) in db.execute(text(f"SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='{table}'")).all():
            db.execute(text(f"DROP TRIGGER {name}"))


@needs_prolog
@pytest.mark.parametrize("table,sql", [
    ("entries", "UPDATE entries SET original_text='A forged memory.' WHERE seq=1"),
    ("policy_versions", "UPDATE policy_versions SET source='allow maria verbatim access to entries;'"),
])
def test_tampering_stops_all_sharing_with_beneficiaries(db, client, table, sql):
    owner, maria = _released_family(db)
    h = login(client, maria.email)
    assert client.get("/api/letters", headers=h).status_code == 200  # intact: works
    _drop_guard(db, table)
    db.execute(text(sql))
    db.commit()
    for r in (client.get("/api/letters", headers=h), client.get("/api/beneficiary/overview", headers=h),
              client.post("/api/assistant/ask", headers=h, json={"question": "What did she plant?"})):
        assert r.status_code == 503 and "integrity" in r.json()["detail"]
        assert "mango" not in r.text and "brave" not in r.text
    actions = db.scalars(select(AuditRow.action).where(AuditRow.owner_id == owner.id)).all()
    assert "integrity.failed" in actions
    # The owner can still open the vault to see what went wrong.
    assert client.get("/api/vault/verify", headers=login(client, owner.email)).json()["ok"] is False


def test_policy_syntax_error_keeps_the_previous_policy(db, client):
    owner = make_owner(db, "syntax@example.com")
    h = login(client, owner.email)
    assert client.put("/api/policy", headers=h, json={"source": "# version one\n"}).status_code == 200
    bad = client.put("/api/policy", headers=h, json={"source": "allow maria verbatim access to"})
    assert bad.status_code == 422
    pol = client.get("/api/policy", headers=h).json()
    assert pol["version"] == 1 and pol["source"].startswith("# version one")
    from app.policy_lang.lexer import tokenize
    with pytest.raises(PolicySyntaxError):
        list(tokenize("allow @maria"))
