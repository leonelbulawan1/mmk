"""Seed a demo vault with FICTIONAL people.  Run:  python -m app.seed  [--reset]

Accounts created (password for all: alaala2026):
  owner        elena@example.com   Elena Ramos (fictional diarist)
  beneficiary  maria@example.com   Maria  - daughter
  beneficiary  jose@example.com    Jose   - son
  beneficiary  lina@example.com    Lina   - childhood friend
"""
from __future__ import annotations

import sys
from datetime import date

from sqlalchemy import select

from pathlib import Path

from .config import settings
from .db import SessionLocal, engine, init_db
from .models import User, now_iso
from .security_hashing import hash_password
from .services import policy_service, vault_service

PASSWORD = "alaala2026"

ENTRIES = [
    ("First day at the new school", "2012-06-04", "light_fix",
     "today Maria started grade one. She held my hand untill the gate and then ran to her teacher without "
     "looking back. I cried a little in the jeep going home. #milestones"),
    ("Sunday adobo", "2014-09-21", "verbatim",
     "Cooked adobo the way Lola Carmen taught me, with extra garlic and a bay leaf. Jose asked for thirds. "
     "The whole family sat together for once, and nobody looked at a phone."),
    ("The doctor's news", "2016-03-02", "verbatim",
     "The doctor said my blood pressure is too high and I need medicine every day. I have not told the kids. "
     "I do not want them to worry about my health while they are studying."),
    ("Promotion", "2017-11-15", "review",
     "I got the promotion at work! Head of the records office after eleven years. i think Papa would have been "
     "proud. We celebrated with pancit at the office."),
    ("Trip to Donsol", "2018-04-08", "verbatim",
     "We took a trip to Donsol to see the butanding. Lina came with us, like old times. We laughed about the "
     "summer we got lost in the province when we were ten."),
    ("Money worries", "2019-08-30", "verbatim",
     "Paid the last of the loan for the house today. The budget was tight for years and I never told anyone how "
     "close we came to selling. The savings account is finally growing again."),
    ("Jose's graduation", "2020-07-12", "light_fix",
     "Jose graduated from university today, online because of the pandemic. We watched on teh laptop in the "
     "living room and I made him wear his toga anyway. My son, an engineer!"),
    ("Lina's birthday", "2021-02-14", "verbatim",
     "Lina turned fifty. We called for two hours. She is the best friend anyone could ask for, and she still "
     "remembers every silly thing we did at school."),
    ("Garden", "2022-05-01", "verbatim",
     "Planted calamansi and tomatoes in the garden. The house feels quieter now that both kids have moved "
     "out, but the garden keeps me busy every morning."),
    ("Check-up", "2023-10-19", "verbatim",
     "Another hospital check-up. The doctor is happy with the new medicine. I finally told Maria about my health "
     "and she made me promise to walk every day."),
]

LETTERS = [
    ("To Maria, for after", "2024-01-01", "maria", None, True,
     "Dear Maria, if you are reading this, I am gone. You were my first brave thing. Keep the adobo recipe, "
     "keep your laugh, and call your brother on Sundays. I love you always."),
    ("To Jose, on your 40th", "2024-01-02", "jose", date(2035, 6, 1), True,
     "Dear Jose, happy fortieth birthday. I hope you still build things that make people's lives easier. "
     "I am proud of you, anak."),
]

POLICY = """# Elena's legacy policy (fictional demo)
group family = maria, jose;
group kids = maria, jose;

# My children may see summaries of family moments.
allow kids summary access to entries about "family";
allow maria verbatim access to entries about "family";

# Jose may read everything from 2015 on, but never my health or money worries.
allow jose verbatim access to entries from 2015-01-01 after death;
deny jose access to entries about "health";
deny jose access to entries about "money";

# Lina may know entries exist, and read the ones about her after 2030.
allow lina existence access to entries;
allow lina verbatim access to entries mentioning "lina" after 2030-01-01;

# Letters
release letters to maria after death;
release letters to jose after 2035-06-01;
"""


def seed(reset: bool = False) -> None:
    if reset and settings.database_url.startswith("sqlite:///"):
        db_file = Path(settings.database_url[len("sqlite:///"):])
        if db_file.exists():
            engine.dispose()
            db_file.unlink()
    init_db()
    db = SessionLocal()
    try:
        if db.scalars(select(User).where(User.email == "elena@example.com")).first():
            print("Demo data already present (use --reset to recreate).")
            return
        owner = User(role="owner", email="elena@example.com", display_name="Elena Ramos",
                     password_hash=hash_password(PASSWORD), default_writing_mode="light_fix",
                     email_verified_at=now_iso())
        db.add(owner)
        db.flush()
        for name, handle, rel in (("Maria Ramos", "maria", "Daughter"), ("Jose Ramos", "jose", "Son"),
                                  ("Lina Cruz", "lina", "Childhood friend")):
            db.add(User(role="beneficiary", email=f"{handle}@example.com", display_name=name, owner_id=owner.id,
                        handle=handle, relationship=rel, password_hash=hash_password(PASSWORD),
                        email_verified_at=now_iso()))
        db.commit()
        owner.executor_id = db.scalars(select(User).where(User.email == "maria@example.com")).one().id  # Maria is executor
        db.commit()
        for title, d, mode, text in ENTRIES:
            vault_service.create_entry(db, owner, title=title, text=text, entry_date=date.fromisoformat(d),
                                       mode_key=mode)
        for title, d, to, rel_on, on_death, text in LETTERS:
            vault_service.create_entry(db, owner, title=title, text=text, entry_date=date.fromisoformat(d),
                                       mode_key="verbatim", kind="letter", recipient_handle=to, release_on=rel_on,
                                       release_on_death=on_death)
        result, _ = policy_service.save_policy(db, owner, POLICY)
        assert result.ok, result.errors
        print("Seeded fictional demo vault.  Password for every account:", PASSWORD)
        print("  owner: elena@example.com   beneficiaries: maria@ / jose@ / lina@example.com")
    finally:
        db.close()


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
