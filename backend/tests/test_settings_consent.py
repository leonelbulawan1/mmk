"""Owner consent for AI answers, and a beneficiary's choice about letter emails."""
from datetime import date

import pytest

from app.config import today
from app.models import EmailNotice
from app.prolog.engine import swipl_available
from app.services import notify

from .conftest import add_entry, login, make_beneficiary, make_owner
from .test_death_notices import FakeSMTP, smtp  # noqa: F401  (fixture)


def test_the_owner_can_withdraw_consent_for_ai_answers(client, db):
    owner = make_owner(db, "lito.ai@example.com", "Lito Cruz")
    make_beneficiary(db, owner, "mara", "Mara Cruz")
    h = login(client, owner.email)
    assert client.get("/api/auth/me", headers=h).json()["allow_ai_answers"] is True
    assert client.put("/api/settings", headers=h, json={"allow_ai_answers": False}).status_code == 200
    r = client.post("/api/assistant/ask", headers=h, json={"question": "What did he love?", "as_handle": "mara"})
    assert r.status_code == 403 and "chose not to" in r.json()["detail"]
    actions = [a["action"] for a in client.get("/api/vault/audit", headers=h).json()]
    assert "settings.update" in actions


@pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")
def test_a_beneficiary_can_turn_off_letter_emails(client, db, smtp):
    owner = make_owner(db, "lito.mail@example.com", "Lito Cruz")
    mara = make_beneficiary(db, owner, "mara", "Mara Cruz")
    hb = login(client, mara.email)
    assert client.put("/api/settings", headers=hb, json={"email_letters": False}).status_code == 200
    assert client.put("/api/settings", headers=hb, json={"allow_ai_answers": False}).status_code == 403
    add_entry(db, owner, "Dear Mara", "2025-01-01", kind="letter", recipient_handle="mara", release_on=today(),
              release_on_death=False, deliver_while_alive=True)
    db.expire_all()  # the preference was saved through the API, in another session
    assert notify.notify_released_letters(db, min_interval_seconds=0) == 0
    assert FakeSMTP.sent == []
    assert [x["text"] for x in client.get("/api/letters", headers=hb).json()] == ["Dear Mara"]  # still on the home page
