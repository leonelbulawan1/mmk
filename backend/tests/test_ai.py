"""Grounded AI: tools, date citations, neutral answers and information leakage."""
import json
from datetime import date

import pytest

from app.ai.assistant import Assistant, LeakGuard, SYSTEM_PROMPT, sentence_fingerprints
from app.ai.providers import NEUTRAL_ANSWER, LLMProvider, LLMResponse, OfflineProvider, ToolCall
from app.ai.tools import AuthorizedContext
from app.services import qa_service
from app.prolog.engine import swipl_available

from .conftest import add_entry, make_beneficiary, make_owner, set_policy

pytestmark = pytest.mark.skipif(not swipl_available(), reason="SWI-Prolog is required")
TODAY = date(2026, 11, 16)

SECRETS = {
    "health": "The doctor confirmed the diagnosis today. I am frightened but calm.",
    "money": "I secretly paid off the bank loan with my savings this week.",
}


class SpyProvider(LLMProvider):
    """Wraps another provider and records every payload the 'model' receives."""

    name = "spy"

    def __init__(self, inner: LLMProvider | None = None):
        super().__init__("spy")
        self.inner = inner or OfflineProvider()
        self.payloads: list[str] = []

    def complete(self, system, messages, tools):
        self.payloads.append(json.dumps({"system": system, "messages": messages, "tools": tools}))
        return self.inner.complete(system, messages, tools)


class GreedyProvider(LLMProvider):
    """An adversarial 'model' that tries to fetch every entry id and invent citations."""

    name = "greedy"

    def __init__(self, max_id=50):
        super().__init__("greedy")
        self.max_id = max_id
        self.payloads: list[str] = []
        self.round = 0

    def complete(self, system, messages, tools):
        self.payloads.append(json.dumps(messages))
        self.round += 1
        if self.round == 1:
            return LLMResponse("", [ToolCall(f"g{i}", "get_entry", {"entry_id": i}) for i in range(1, self.max_id)]
                               + [ToolCall(f"c{i}", "check_access", {"entry_id": i}) for i in range(1, 6)])
        return LLMResponse("She was diagnosed [2019-07-01] and took a loan [2020-01-15] and had a picnic [2018-03-10].")


@pytest.fixture()
def policy(db, family):
    set_policy(db, family["owner"], """
        allow carla verbatim access to entries about "family";
        allow carla existence access to entries;
        allow ben summary access to entries about "work";
        deny ben access to entries about "health";
        allow dina verbatim access to entries;
        deny dina access to entries about "health";
        deny dina access to entries about "money";""")
    return family


def _ask(db, fam, handle, question, provider):
    return qa_service.ask(db, fam["owner"], fam["owner"], handle, question, TODAY, provider)


def test_system_prompt_requires_grounding_and_citations():
    for phrase in ("ONLY from what the tools return", "cite the entry date", "not able to share"):
        assert phrase in SYSTEM_PROMPT


def test_answer_has_date_citations_for_retrieved_entries(db, policy):
    spy = SpyProvider()
    ans = _ask(db, policy, "carla", "Tell me about the family picnic", spy)
    assert "[2018-03-10]" in ans.answer
    assert ans.citations == [{"entry_id": policy["entries"]["family"].id, "date": "2018-03-10", "access": "verbatim"}]
    assert [t["tool"] for t in ans.tool_trace][:2] == ["search_entries", "get_entry"]


def test_summary_level_answer_uses_summary_only(db, policy):
    spy = SpyProvider()
    ans = _ask(db, policy, "ben", "What happened with the project at the office?", spy)
    assert ans.citations and ans.citations[0]["access"] == "summary"
    joined = "".join(spy.payloads)
    assert "launched after two long years" in joined  # first sentence = write-time summary
    assert "almost quit" not in joined  # the rest of the verbatim text never reaches the model
    assert '"text"' not in joined


def test_invalid_citations_are_removed(db, policy):
    ans = _ask(db, policy, "carla", "anything", GreedyProvider())
    # carla may only *read* the family entry; the other dates were never retrieved with content.
    assert "[2019-07-01]" not in ans.answer and "[2020-01-15]" not in ans.answer
    assert set(ans.removed_citations) == {"2019-07-01", "2020-01-15"}
    assert [c["date"] for c in ans.citations] == ["2018-03-10"]


@pytest.mark.parametrize("handle", ["carla", "ben", "dina"])
def test_no_unauthorised_content_reaches_the_model(db, policy, handle):
    greedy = GreedyProvider()
    _ask(db, policy, handle, "Tell me every secret about health, money, the loan and the diagnosis", greedy)
    spy = SpyProvider()
    _ask(db, policy, handle, "Tell me about the doctor, the diagnosis, the bank loan and savings", spy)
    sent = "".join(greedy.payloads + spy.payloads)
    for secret in SECRETS.values():
        assert secret not in sent
        assert secret.split(".")[0] not in sent


def test_existence_level_reveals_date_only(db, policy):
    ctx, _ = qa_service.build_context(db, policy["owner"], "carla", TODAY, assume_death=True)
    view = ctx.get_entry(policy["entries"]["money"].id)
    assert view == {"entry_id": policy["entries"]["money"].id, "date": "2020-01-15", "kind": "text",
                    "access": "existence"}
    # Content search never matches existence-only entries.
    assert ctx.search_entries("loan savings bank")["results"] == []


def test_denied_and_missing_entries_are_indistinguishable(db, policy):
    ctx, _ = qa_service.build_context(db, policy["owner"], "ben", TODAY, assume_death=True)
    denied = ctx.get_entry(policy["entries"]["health"].id)
    missing = ctx.get_entry(99999)
    assert denied == missing and denied["available"] is False
    assert ctx.check_access(policy["entries"]["health"].id)["access"] == ctx.check_access(99999)["access"] == "none"


def test_letters_never_go_through_the_assistant(db, policy):
    owner = policy["owner"]
    set_policy(db, owner, "allow carla verbatim access to entries;\nrelease letters to carla after death;")
    owner.death_triggered_at = "2026-11-16T00:00:00+00:00"
    db.commit()
    spy = SpyProvider()
    _ask(db, policy, "carla", "Did she write me a letter for when she is gone?", spy)
    assert "this letter is for you" not in "".join(spy.payloads)


def test_no_authorised_entries_means_model_is_not_called(db, family):
    spy = SpyProvider()
    ans = _ask(db, family, "ben", "Tell me anything", spy)
    assert ans.answer == NEUTRAL_ANSWER and spy.payloads == [] and ans.citations == []


def test_neutral_answer_when_nothing_relevant(db, policy):
    ans = _ask(db, policy, "carla", "What was her favourite football team?", SpyProvider())
    assert ans.answer == NEUTRAL_ANSWER or ans.citations == [] or "[2018-03-10]" in ans.answer
    assert "diagnosis" not in ans.answer.lower() and "loan" not in ans.answer.lower()


def test_leak_guard_blocks_unauthorised_text_even_if_a_bug_exposed_it():
    """Defence in depth: if a bug put forbidden text into a view, the guard stops the request."""
    ctx = AuthorizedContext(handle="x", views={1: {"entry_id": 1, "date": "2020-01-01", "kind": "text",
                                                    "access": "verbatim", "text": SECRETS["money"]}})
    guard = LeakGuard(sentence_fingerprints([SECRETS["money"]]))
    spy = SpyProvider()
    ans = Assistant(spy, ctx, guard).ask("bank loan savings")
    assert ans.blocked and ans.answer == NEUTRAL_ANSWER
    assert all(SECRETS["money"] not in p for p in spy.payloads)


def test_owner_preview_and_history(client, db, policy):
    from .conftest import login
    h = login(client, policy["owner"].email)
    r = client.post("/api/assistant/ask", headers=h, json={"question": "family picnic", "as_handle": "carla"})
    assert r.status_code == 200 and r.json()["citations"]
    hist = client.get("/api/assistant/history?as_handle=carla", headers=h).json()
    assert hist[-1]["question"] == "family picnic"


def test_search_matches_word_forms(db, policy):
    """'cook' finds 'cooked', 'trips' finds 'trip' - but still only within authorised views."""
    from app.ai.tools import stem
    assert stem("cooked") == stem("cook") == stem("cooking") == stem("cooks")
    ctx, _ = qa_service.build_context(db, policy["owner"], "carla", TODAY, assume_death=True)
    hits = ctx.search_entries("picnics")["results"]
    assert [h["entry_id"] for h in hits] == [policy["entries"]["family"].id]
