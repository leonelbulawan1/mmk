"""Reports of an owner's passing are checked by an MMK reviewer before anything is released (DEATH_REVIEW=admin)."""
import base64
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from app.config import settings
from app.models import DeathEvidence, DeathReport, User
from app.services import death

from .conftest import PASSWORD, login, make_beneficiary, make_owner

PDF = b"%PDF-1.4\n% fictional death certificate for tests\n"


@pytest.fixture(autouse=True)
def review_mode():
    saved = settings.death_review
    object.__setattr__(settings, "death_review", "admin")
    yield
    object.__setattr__(settings, "death_review", saved)


@pytest.fixture()
def case(client, db):
    owner = make_owner(db, "juan.review@example.com", "Juan Santos")
    maria = make_beneficiary(db, owner, "maria", "Maria Santos")
    ana = make_beneficiary(db, owner, "ana", "Ana Santos")
    owner.executor_id = maria.id
    db.commit()
    reviewer = make_owner(db, "reviewer@example.com", "Rhea Reviewer")
    hm = login(client, maria.email)
    r = client.post("/api/executor/report", headers=hm, json={"password": PASSWORD, "confirmation": "REPORT PASSING"})
    assert r.status_code == 200, r.text
    return {"owner": owner, "maria": maria, "ana": ana, "reviewer": reviewer, "hm": hm,
            "hr": login(client, reviewer.email), "rid": r.json()["report"]["id"]}


def _upload(client, h, content=PDF, name="certificate.pdf"):
    return client.post("/api/executor/report/evidence", headers=h,
                       json={"filename": name, "content_base64": base64.b64encode(content).decode()})


def _approve(client, c, password=PASSWORD):
    return client.post(f"/api/review/cases/{c['rid']}/approve", headers=c["hr"], json={"note": "Certificate checked", "password": password})


def _due(db, rid):
    db.execute(update(DeathReport).where(DeathReport.id == rid)
               .values(activates_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()))
    db.commit()


def test_a_report_waits_for_a_reviewer_and_never_activates_by_itself(client, db, case):
    rep = db.get(DeathReport, case["rid"])
    assert rep.status == "reported" and rep.activates_at == death.NOT_SET
    assert death.process_due(db) == 0
    db.refresh(case["owner"])
    assert case["owner"].death_triggered_at is None


def test_full_flow_with_evidence_review_waiting_period_and_activation(client, db, case):
    assert _upload(client, case["hm"]).status_code == 200
    ev = db.query(DeathEvidence).one()
    assert ev.data != PDF and PDF not in ev.data  # stored encrypted
    cases = client.get("/api/review/cases", headers=case["hr"]).json()
    assert [c["status"] for c in cases] == ["reported"] and cases[0]["owner_name"] == "Juan Santos"
    assert client.post(f"/api/review/cases/{case['rid']}/start", headers=case["hr"]).json()["status"] == "under_review"
    got = client.get(f"/api/review/evidence/{ev.id}", headers=case["hr"]).json()
    assert base64.b64decode(got["content_base64"]) == PDF and got["content_type"] == "application/pdf"
    assert _approve(client, case, "wrong-password").status_code == 400
    r = _approve(client, case)
    assert r.status_code == 200 and r.json()["status"] == "verified" and r.json()["activates_at"]
    assert death.process_due(db) == 0  # the waiting period is still running
    _due(db, case["rid"])
    assert death.process_due(db) == 1
    db.refresh(case["owner"])
    assert case["owner"].death_triggered_at
    actions = [h["action"] for h in client.get(f"/api/review/cases/{case['rid']}", headers=case["hr"]).json()["history"]]
    assert actions[:4] == ["reported", "evidence_added", "review_started", "evidence_viewed"] and "report_verified" in actions


def test_approval_needs_evidence(client, db, case):
    client.post(f"/api/review/cases/{case['rid']}/start", headers=case["hr"])
    r = _approve(client, case)
    assert r.status_code == 409 and "no evidence" in r.json()["detail"]


def test_a_dispute_stops_activation_until_reviewed_again(client, db, case):
    _upload(client, case["hm"])
    client.post(f"/api/review/cases/{case['rid']}/start", headers=case["hr"])
    _approve(client, case)
    ha = login(client, case["ana"].email)
    assert client.get("/api/auth/me", headers=ha).json()["open_report"]["can_dispute"] is True
    r = client.post("/api/executor/dispute", headers=ha, json={"reason": "I spoke with Juan yesterday."})
    assert r.status_code == 200
    _due(db, case["rid"])
    db.execute(update(DeathReport).where(DeathReport.id == case["rid"]).values(activates_at=death.NOT_SET)); db.commit()
    assert death.process_due(db) == 0
    rep = db.get(DeathReport, case["rid"]); db.refresh(rep)
    assert rep.status == "disputed" and rep.dispute_reason.startswith("I spoke")
    r = client.post(f"/api/review/cases/{case['rid']}/reject", headers=case["hr"], json={"note": "Owner is alive"})
    assert r.json()["status"] == "rejected"
    db.refresh(case["owner"])
    assert case["owner"].death_triggered_at is None


def test_only_reviewers_can_review_and_never_their_own_case(client, db, case):
    hm = case["hm"]
    assert client.get("/api/review/cases", headers=hm).status_code == 403
    ho = login(client, case["owner"].email)
    assert client.get("/api/review/cases", headers=ho).status_code == 403
    assert client.get("/api/auth/me", headers=case["hr"]).json()["is_reviewer"] is True
    rep = db.get(DeathReport, case["rid"])
    with pytest.raises(PermissionError):
        death.start_review(db, db.get(User, case["owner"].id), rep)


def test_two_reviewers_cannot_both_decide(client, db, case):
    _upload(client, case["hm"])
    client.post(f"/api/review/cases/{case['rid']}/start", headers=case["hr"])
    assert client.post(f"/api/review/cases/{case['rid']}/reject", headers=case["hr"], json={"note": "No"}).status_code == 200
    r = _approve(client, case)  # the case was already closed
    assert r.status_code == 409 and "rejected" in r.json()["detail"]


def test_only_real_pdf_jpeg_png_under_5mb(client, db, case):
    assert _upload(client, case["hm"], b"MZ\x90\x00 not a document", "certificate.pdf").status_code == 400
    assert _upload(client, case["hm"], b"%PDF-" + b"0" * (5 * 1024 * 1024), "big.pdf").status_code == 400
    assert _upload(client, case["hm"], b"\x89PNG\r\n\x1a\n" + b"0" * 100, "photo.png").status_code == 200


def test_the_owner_can_still_cancel(client, db, case):
    ho = login(client, case["owner"].email)
    r = client.post("/api/settings/death-report/cancel", headers=ho)
    assert r.status_code == 200
    assert db.get(DeathReport, case["rid"]).status == "cancelled"
