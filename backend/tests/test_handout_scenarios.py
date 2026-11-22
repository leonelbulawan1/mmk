"""The handout's "Try It Yourself" table, run end to end: Maria asks questions after the death trigger.

Policy (our syntax for the handout's sample protocol):
    allow maria existence access to entries mentioning "maria";
    allow maria summary access to entries about "family";
    release letters to maria after 2040-05-01;
"""
import json
from datetime import date

import pytest

from app.ai.providers import NEUTRAL_ANSWER, OfflineProvider
from app.errors import AmbiguousName
from app.prolog.engine import swipl_available
from app.services import qa_service

from .conftest import add_entry, make_beneficiary, make_owner, set_policy
from .test_ai import SpyProvider

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")

BEFORE, AFTER = date(2026, 11, 22), date(2040, 5, 2)
BUSINESS = "My business lost a big client this month and I worry about payroll."
LETTER = "Dear Maria, you were my bravest thing. Keep laughing."


@pytest.fixture()
def juan(db):
    owner = make_owner(db, "juan@example.com", "Juan Santos")
    maria = make_beneficiary(db, owner, "maria", "Maria Santos")
    stranger = make_beneficiary(db, owner, "adam_jr", "Adam Santos Jr")  # has no protocol at all
    add_entry(db, owner, "Maria learned to ride her bike today. I ran behind her the whole street.", "2010-06-01", title="Bike")
    add_entry(db, owner, "Took Maria to her first piano recital. She bowed twice.", "2012-03-10", title="Recital")
    add_entry(db, owner, "The whole family went to the beach in Batangas. We ate grilled fish.", "2015-04-02", title="Beach")
    add_entry(db, owner, "Our family reunion was loud and happy. Lola cooked for everyone.", "2018-12-25", title="Reunion")
    add_entry(db, owner, BUSINESS, "2019-08-14", title="Client")
    add_entry(db, owner, LETTER, "2025-01-01", title="To my daughter", kind="letter", recipient_handle="maria",
              release_on=date(2040, 5, 1), release_on_death=False)
    set_policy(db, owner, """
        allow maria existence access to entries mentioning "maria";
        allow maria summary access to entries about "family";
        release letters to maria after 2040-05-01;""")
    owner.death_triggered_at = "2026-11-20T00:00:00+00:00"
    db.commit()
    return {"owner": owner, "maria": maria, "stranger": stranger}


def ask(db, fam, who, question, today=BEFORE, provider=None):
    asker = fam[who]
    return qa_service.ask(db, fam["owner"], asker, asker.handle, question, today, provider or OfflineProvider())


def test_did_he_ever_write_about_me_gives_count_not_content(db, juan):
    a = ask(db, juan, "maria", "Did he ever write about me?")
    assert a.answer.startswith("Yes.") and "2 entries" in a.answer
    assert "bike" not in a.answer.lower() and "piano" not in a.answer.lower()
    assert a.citations == []  # existence access cannot back a citation


def test_family_question_gives_summaries_with_dates(db, juan):
    a = ask(db, juan, "maria", "What did he write about family?")
    assert {c["date"] for c in a.citations} == {"2015-04-02", "2018-12-25"}
    assert all(c["access"] == "summary" for c in a.citations)
    assert "grilled fish" not in a.answer  # summary, not the full text


def test_letter_before_release_date_is_refused(db, juan):
    spy = SpyProvider()
    a = ask(db, juan, "maria", "Show me the letter to my daughter", BEFORE, spy)
    assert "not been released" in a.answer and "2040-05-01" in a.answer
    assert "bravest" not in a.answer and "bravest" not in "".join(spy.payloads)  # the text never reached the model


def test_letter_on_or_after_release_date_is_shown_verbatim(db, juan):
    a = ask(db, juan, "maria", "Show me the letter to my daughter", AFTER)
    assert LETTER in a.answer and [c["date"] for c in a.citations] == ["2025-01-01"]


def test_business_question_is_neutral_and_does_not_confirm_entries(db, juan):
    spy = SpyProvider()
    a = ask(db, juan, "maria", "What did he think about his business?", BEFORE, spy)
    assert a.answer == NEUTRAL_ANSWER
    assert "payroll" not in "".join(spy.payloads) and "client" not in "".join(spy.payloads).lower()


@pytest.mark.parametrize("question", ["What did he think about his business?", "Did he ever write about me?",
                                      "Show me the letter to my daughter", "Tell me anything"])
def test_person_with_no_protocol_gets_the_same_neutral_reply(db, juan, question):
    spy = SpyProvider()
    for today in (BEFORE, AFTER):
        a = ask(db, juan, "stranger", question, today, spy)
        assert a.answer == NEUTRAL_ANSWER and a.citations == []
    assert spy.payloads == []  # nothing authorised: the model is never called


def test_other_people_never_receive_marias_letter(db, juan):
    owner = juan["owner"]
    owner.death_triggered_at = None  # the policy is frozen after the trigger, so change it first
    db.commit()
    set_policy(db, owner, 'allow adam_jr verbatim access to entries;\nrelease letters to everyone after 2040-05-01;')
    owner.death_triggered_at = "2026-11-20T00:00:00+00:00"
    db.commit()
    spy = SpyProvider()
    a = ask(db, juan, "stranger", "Is there a letter for me?", AFTER, spy)
    assert "bravest" not in a.answer and "bravest" not in "".join(spy.payloads) and "To my daughter" not in a.answer


def test_ambiguous_name_falls_back_to_sharing_nothing(db, juan):
    make_beneficiary(db, juan["owner"], "maria_c", "Maria Cruz")  # a second Maria
    with pytest.raises(AmbiguousName):
        qa_service.asker_names(db, juan["owner"], "maria")
    a = ask(db, juan, "maria", "Did he ever write about me?")
    assert a.answer == NEUTRAL_ANSWER  # safe action: never guess which Maria is meant
