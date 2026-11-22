"""SWI-Prolog access rules: deny-by-default, deny overrides, levels, dates, death, frozen policy."""
from datetime import date

import pytest

from app.domain import PolicyFrozenError
from app.prolog.engine import swipl_available
from app.services import policy_service

from .conftest import login, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")

TODAY = date(2026, 11, 16)


def levels(db, fam, handle, when=TODAY, after_death=True):
    """Decisions as they will be after the owner's passing (the policy only applies then).
    ``after_death=False`` gives the real decisions while the owner is alive."""
    d = policy_service.decisions_for(db, fam["owner"], handle, when, assume_death=after_death)
    return {k: d[e.id].level for k, e in fam["entries"].items()}, {k: d[e.id].reason for k, e in fam["entries"].items()}


def test_deny_by_default_with_no_policy(db, family):
    lv, reasons = levels(db, family, "carla")
    assert set(lv.values()) == {"none"}
    assert reasons["family"] == "default_deny"


def test_existence_summary_verbatim_levels(db, family):
    set_policy(db, family["owner"], """
        allow carla existence access to entries;
        allow ben summary access to entries;
        allow dina verbatim access to entries;""")
    assert levels(db, family, "carla")[0]["work"] == "existence"
    assert levels(db, family, "ben")[0]["work"] == "summary"
    assert levels(db, family, "dina")[0]["work"] == "verbatim"


def test_highest_matching_grant_wins(db, family):
    set_policy(db, family["owner"], """
        allow carla existence access to entries;
        allow carla verbatim access to entries about "family";""")
    lv, reasons = levels(db, family, "carla")
    assert lv["family"] == "verbatim" and lv["work"] == "existence"
    assert reasons["family"] == "granted_by(2)"


def test_explicit_denial_overrides_permission(db, family):
    set_policy(db, family["owner"], """
        allow ben verbatim access to entries;
        deny ben access to entries about "health";
        allow ben verbatim access to entries about "health";""")
    lv, reasons = levels(db, family, "ben")
    assert lv["health"] == "none" and reasons["health"] == "denied_by(2)"
    assert lv["work"] == "verbatim"


def test_conflicting_group_and_individual_rules(db, family):
    set_policy(db, family["owner"], """
        group kids = carla, ben;
        allow kids verbatim access to entries;
        deny ben access to entries about "money";
        deny everyone access to entries mentioning "carla";""")
    carla, ben = levels(db, family, "carla")[0], levels(db, family, "ben")[0]
    assert carla["money"] == "verbatim" and ben["money"] == "none"
    assert carla["family"] == "none" and ben["family"] == "none"  # everyone-deny beats group allow
    assert levels(db, family, "dina")[0]["work"] == "none"  # not in the group, deny by default


def test_date_filters(db, family):
    set_policy(db, family["owner"], "allow dina verbatim access to entries from 2019-01-01 until 2020-12-31;")
    lv = levels(db, family, "dina")[0]
    assert (lv["family"], lv["health"], lv["money"], lv["work"]) == ("none", "verbatim", "verbatim", "none")


def test_date_based_release(db, family):
    set_policy(db, family["owner"], "allow carla summary access to entries after 2030-01-01;")
    before, reasons = levels(db, family, "carla", date(2029, 12, 31))
    assert before["work"] == "none" and reasons["work"] == "pending(1)"
    on_day = levels(db, family, "carla", date(2030, 1, 1))[0]
    assert on_day["work"] == "summary"


def test_release_after_death(db, family):
    owner = family["owner"]
    set_policy(db, owner, "allow ben verbatim access to entries after death;\nrelease letters to carla after death;")
    assert levels(db, family, "ben", after_death=False)[0]["work"] == "none"
    assert levels(db, family, "carla", after_death=False)[0]["letter"] == "none"
    owner.death_triggered_at = "2026-11-16T00:00:00+00:00"
    db.commit()
    assert levels(db, family, "ben")[0]["work"] == "verbatim"
    assert levels(db, family, "carla")[0]["letter"] == "verbatim"


def test_letters_only_reach_their_recipient(db, family):
    owner = family["owner"]
    set_policy(db, owner, "release letters to everyone after death;\nallow ben verbatim access to entries;")
    owner.death_triggered_at = "2026-11-16T00:00:00+00:00"
    db.commit()
    lv, reasons = levels(db, family, "ben")
    assert lv["letter"] == "none" and reasons["letter"] == "not_recipient"
    assert levels(db, family, "carla")[0]["letter"] == "verbatim"


def test_letter_needs_policy_release(db, family):
    owner = family["owner"]
    owner.death_triggered_at = "2026-11-16T00:00:00+00:00"
    db.commit()
    lv, reasons = levels(db, family, "carla")
    assert lv["letter"] == "none" and reasons["letter"] == "default_deny"


def test_unregistered_or_deactivated_beneficiary_gets_nothing(db, family):
    set_policy(db, family["owner"], "allow everyone verbatim access to entries;")
    assert set(levels(db, family, "stranger")[0].values()) == {"none"}
    family["bens"]["dina"].active = False
    db.commit()
    assert set(levels(db, family, "dina")[0].values()) == {"none"}


def test_policy_frozen_after_death_trigger(db, family, client):
    owner = family["owner"]
    set_policy(db, owner, "allow carla summary access to entries;")
    h = login(client, owner.email)
    r = client.post("/api/settings/death-trigger", headers=h,
                    json={"password": "testpass123", "confirmation": "SEAL MY VAULT"})
    assert r.status_code == 200
    db.refresh(owner)
    assert policy_service.engine_for(db, owner).can_modify_policy() is False
    with pytest.raises(PolicyFrozenError):
        policy_service.save_policy(db, owner, "allow carla verbatim access to entries;")
    r = client.put("/api/policy", headers=h, json={"source": "allow carla verbatim access to entries;"})
    assert r.status_code == 403
    # The frozen policy is still the one in force.
    assert levels(db, family, "carla")[0]["work"] == "summary"


def test_access_matrix_endpoint(db, family, client):
    set_policy(db, family["owner"], 'allow carla summary access to entries about "family";')
    h = login(client, family["owner"].email)
    body = client.get("/api/access/matrix?on=2026-11-16", headers=h).json()
    fam_id = str(family["entries"]["family"].id)
    assert body["decisions"]["carla"][fam_id]["level"] == "summary"
    assert body["decisions"]["carla"][fam_id]["line"] == 1
    assert body["decisions"]["ben"][fam_id]["level"] == "none"


def test_nothing_is_shared_while_the_owner_is_alive(db, family):
    """The diary opens only after the owner's passing, whatever the policy says."""
    set_policy(db, family["owner"], """
        allow everyone verbatim access to entries;
        release letters to carla after 2000-01-01;""")
    for handle in ("carla", "ben", "dina"):
        lv, reasons = levels(db, family, handle, after_death=False)
        assert set(lv.values()) == {"none"}
        assert set(reasons.values()) == {"owner_alive"}
    # the same policy applies in full once the death trigger is active
    family["owner"].death_triggered_at = "2026-11-16T00:00:00+00:00"
    db.commit()
    lv, _ = levels(db, family, "carla", after_death=False)
    assert lv["work"] == "verbatim" and lv["letter"] == "verbatim"


def test_beneficiary_endpoints_share_nothing_before_death(db, family, client):
    set_policy(db, family["owner"], "allow carla verbatim access to entries;")
    h = login(client, family["bens"]["carla"].email)
    assert client.get("/api/beneficiary/overview", headers=h).json()["shared_entries"] == 0
    assert client.get("/api/letters", headers=h).json() == []
    ans = client.post("/api/assistant/ask", headers=h, json={"question": "Tell me about the family picnic"}).json()
    assert ans["citations"] == [] and "picnic" not in ans["answer"].lower()


def test_owner_previews_show_the_after_death_view(db, family, client):
    set_policy(db, family["owner"], "allow carla summary access to entries;")
    h = login(client, family["owner"].email)
    fam_id = str(family["entries"]["family"].id)
    assert client.get("/api/access/matrix", headers=h).json()["decisions"]["carla"][fam_id]["level"] == "summary"
    live = client.get("/api/access/matrix?after_death=false", headers=h).json()["decisions"]["carla"][fam_id]
    assert live == {"level": "none", "reason": "owner_alive", "line": None}
