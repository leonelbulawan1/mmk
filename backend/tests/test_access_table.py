"""The access test table in docs/ACCESS_TEST_TABLE.md, row by row (asker, entry, expected result).
Regenerate the document with:  python -m scripts.access_table"""
from datetime import date

import pytest

from app.prolog.engine import swipl_available
from app.services import policy_service

from .conftest import add_entry, make_beneficiary, make_owner, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")

POLICY = '''allow maria existence access to entries mentioning "maria";
allow maria summary access to entries about "family";
deny maria access to entries about "money";
release letters to maria after 2040-05-01;'''
NOW, LATER = date(2026, 11, 22), date(2040, 5, 2)

# (row, asker, entry key, date, after death?, expected level, expected reason prefix)
TABLE = [
    (1, "maria", "bike", NOW, False, "none", "owner_alive"),
    (2, "maria", "beach", NOW, False, "none", "owner_alive"),
    (3, "maria", "loan", NOW, False, "none", "owner_alive"),
    (4, "maria", "client", NOW, False, "none", "owner_alive"),
    (5, "maria", "letter", NOW, False, "none", "owner_alive"),
    (6, "adam_jr", "bike", NOW, False, "none", "owner_alive"),
    (7, "adam_jr", "beach", NOW, False, "none", "owner_alive"),
    (8, "adam_jr", "loan", NOW, False, "none", "owner_alive"),
    (9, "adam_jr", "client", NOW, False, "none", "owner_alive"),
    (10, "adam_jr", "letter", NOW, False, "none", "owner_alive"),
    (11, "maria", "bike", NOW, True, "existence", "granted_by"),
    (12, "maria", "beach", NOW, True, "summary", "granted_by"),
    (13, "maria", "loan", NOW, True, "none", "denied_by"),
    (14, "maria", "client", NOW, True, "none", "default_deny"),
    (15, "maria", "letter", NOW, True, "none", "letter_sealed"),
    (16, "adam_jr", "bike", NOW, True, "none", "default_deny"),
    (17, "adam_jr", "beach", NOW, True, "none", "default_deny"),
    (18, "adam_jr", "loan", NOW, True, "none", "default_deny"),
    (19, "adam_jr", "client", NOW, True, "none", "default_deny"),
    (20, "adam_jr", "letter", NOW, True, "none", "not_recipient"),
    (21, "maria", "letter", LATER, True, "verbatim", "released_by"),
    (22, "adam_jr", "letter", LATER, True, "none", "not_recipient"),
]


@pytest.fixture()
def juan(db):
    owner = make_owner(db, "juan.table@example.com", "Juan Santos")
    make_beneficiary(db, owner, "maria", "Maria Santos")
    make_beneficiary(db, owner, "adam_jr", "Adam Santos Jr")
    e = {
        "bike": add_entry(db, owner, "Maria learned to ride her bike today.", "2010-06-01"),
        "beach": add_entry(db, owner, "The whole family went to the beach in Batangas.", "2015-04-02"),
        "loan": add_entry(db, owner, "Our family argued about money and the loan.", "2017-02-11"),
        "client": add_entry(db, owner, "My business lost a big client this month.", "2019-08-14"),
        "letter": add_entry(db, owner, "Dear Maria, you were my bravest thing.", "2025-01-01", kind="letter",
                            recipient_handle="maria", release_on=date(2040, 5, 1), release_on_death=False),
    }
    set_policy(db, owner, POLICY)
    return owner, e


@pytest.mark.parametrize("row,asker,key,today,dead,level,reason", TABLE, ids=[f"row{r[0]}" for r in TABLE])
def test_access_table_row(db, juan, row, asker, key, today, dead, level, reason):
    owner, entries = juan
    d = policy_service.engine_for(db, owner, assume_death=dead).decide_all(asker, today)[int(entries[key].id)]
    assert (d.level, d.reason.split("(")[0]) == (level, reason), f"row {row}"
