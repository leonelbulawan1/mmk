"""Print the access test table (asker, entry, expected result) as Markdown, computed by the real Prolog rules.

Usage:  cd backend && python -m scripts.access_table > ../docs/access_table_generated.md
Builds the handout's sample (owner Juan, beneficiary Maria, and a person with no protocol) in a throwaway
SQLite database, then asks Prolog for every (asker, entry) decision on two dates, before and after the
owner's death trigger.
"""
from __future__ import annotations

import os
import sys
import tempfile
from datetime import date

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/table.db"
os.environ.setdefault("JWT_SECRET", "table")

from app.db import SessionLocal, init_db  # noqa: E402
from app.models import User  # noqa: E402
from app.security_hashing import hash_password  # noqa: E402
from app.services import policy_service, vault_service  # noqa: E402

LEVEL = {"none": "nothing", "existence": "existence only", "summary": "summary", "verbatim": "full text"}
POLICY = '''allow maria existence access to entries mentioning "maria";
allow maria summary access to entries about "family";
deny maria access to entries about "money";
release letters to maria after 2040-05-01;'''


def reason_text(reason: str) -> str:
    if reason.startswith("granted_by"):
        return "allowed by a rule"
    if reason.startswith("denied_by"):
        return "explicit deny wins"
    if reason.startswith("released_by"):
        return "letter released"
    if reason.startswith("pending"):
        return "release date not reached"
    return {"default_deny": "deny by default (no rule allows it)", "owner_alive": "owner is alive: nothing is shared",
            "not_recipient": "letter is addressed to someone else", "letter_sealed": "letter's own date not reached",
            "not_beneficiary": "not a registered beneficiary"}.get(reason, reason)


def main() -> None:
    init_db()
    db = SessionLocal()
    owner = User(role="owner", email="juan@example.com", display_name="Juan Santos",
                 password_hash=hash_password("table-pass-1"), email_verified_at="2026-01-01")
    db.add(owner)
    db.commit()
    for handle, name in (("maria", "Maria Santos"), ("adam_jr", "Adam Santos Jr")):
        db.add(User(role="beneficiary", email=f"{handle}@example.com", display_name=name, owner_id=owner.id,
                    handle=handle, password_hash=hash_password("table-pass-1"), active=True,
                    email_verified_at="2026-01-01"))
    db.commit()
    rows = [
        ("Maria learned to ride her bike today.", "2010-06-01", "Bike (mentions Maria)", {}),
        ("The whole family went to the beach in Batangas.", "2015-04-02", "Beach (family)", {}),
        ("Our family argued about money and the loan.", "2017-02-11", "Loan talk (family + money)", {}),
        ("My business lost a big client this month.", "2019-08-14", "Client (business)", {}),
        ("Dear Maria, you were my bravest thing.", "2025-01-01", "Letter: To my daughter",
         {"kind": "letter", "recipient_handle": "maria", "release_on": date(2040, 5, 1), "release_on_death": False}),
    ]
    ids = {}
    for text, d, label, kw in rows:
        e, _ = vault_service.create_entry(db, owner, title=label, text=text, entry_date=date.fromisoformat(d),
                                          mode_key="verbatim", **kw)
        ids[int(e.id)] = (d, label)
    result, _ = policy_service.save_policy(db, owner, POLICY)
    assert result.ok, result.errors

    out = ["| # | Asker | Entry | When | Expected result | Why |", "|---|---|---|---|---|---|"]
    n = 0
    scenarios = [("before the death trigger", date(2026, 11, 22), False),
                 ("after the trigger", date(2026, 11, 22), True),
                 ("after the trigger, on/after 2040-05-01", date(2040, 5, 2), True)]
    for when, today, dead in scenarios:
        engine = policy_service.engine_for(db, owner, assume_death=dead)
        for handle in ("maria", "adam_jr"):
            for eid, d in sorted(engine.decide_all(handle, today).items()):
                if "2040" in when and ids[eid][1].startswith(("Bike", "Beach", "Loan", "Client")):
                    continue  # only the letter changes on that date
                n += 1
                entry_date, label = ids[eid]
                out.append(f"| {n} | {handle} | {label} ({entry_date}) | {when} | **{LEVEL[d.level]}** | {reason_text(d.reason)} |")
    print("Policy used:\n\n```\n" + POLICY + "\n```\n")
    print("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
