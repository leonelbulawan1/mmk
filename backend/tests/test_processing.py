"""Functional entry processing: normalize, extract, correct, diff (pure functions)."""
import dataclasses

import pytest

from app.processing.pure import (Correction, DiffOp, Extraction, apply_diff, correct, diff, extract, normalize,
                                 revert_diff, summarize)


class TestNormalize:
    def test_collapses_whitespace_and_blank_lines(self):
        assert normalize("  Hello   world \r\n\r\n\r\n\nBye\t\tnow  ") == "Hello world\n\nBye now"

    def test_smart_punctuation(self):
        assert normalize("“Hi” ‘there’") == "\"Hi\" 'there'"

    def test_idempotent(self):
        s = "  A  b \n\n\n c "
        assert normalize(normalize(s)) == normalize(s)

    def test_unicode_nfc(self):
        assert normalize("Niño") == "Niño"


class TestExtract:
    def test_names_and_topics(self):
        ex = extract("We visited the doctor with Carla. Later, Ben cooked dinner for the family.", ["carla"])
        assert "carla" in {n.lower() for n in ex.names}
        assert "Ben" in ex.names
        assert {"health", "food", "family"} <= ex.topics

    def test_sentence_initial_words_are_not_names(self):
        ex = extract("Yesterday was long. Rain fell all day.")
        assert "Rain" not in ex.names

    def test_hashtags_become_topics(self):
        assert "milestones" in extract("A big day #Milestones").topics

    def test_result_is_immutable(self):
        ex = extract("Carla smiled.", ["Carla"])
        assert isinstance(ex.names, frozenset) and isinstance(ex.topics, frozenset)
        with pytest.raises(dataclasses.FrozenInstanceError):
            ex.names = frozenset()  # type: ignore[misc]


class TestCorrect:
    def test_fixes_common_errors_and_reports_them(self):
        c = correct("i recieved teh letter , it was wierd.")
        assert c.text == "I received the letter, it was weird."
        rules = {ch.rule for ch in c.changes}
        assert {"typo", "pronoun-i", "space-before-punct"} <= rules
        assert c.original == "i recieved teh letter , it was wierd."

    def test_repeated_words_and_sentence_case(self):
        assert correct("the the cat sat. it slept.").text == "The cat sat. It slept."

    def test_no_change_for_clean_text(self):
        c = correct("All good here.")
        assert not c.changed and c.changes == ()

    def test_pure_does_not_mutate_input(self):
        s = "teh end"
        correct(s)
        assert s == "teh end"

    def test_correction_is_frozen(self):
        with pytest.raises(dataclasses.FrozenInstanceError):
            correct("x").text = "y"  # type: ignore[misc]


class TestDiff:
    def test_roundtrip(self):
        a, b = "I recieved teh letter", "I received the letter"
        ops = diff(a, b)
        assert isinstance(ops, tuple) and all(isinstance(o, DiffOp) for o in ops)
        assert apply_diff(ops) == b and revert_diff(ops) == a
        assert any(o.op == "replace" and o.before == "recieved" for o in ops)

    def test_identical_texts(self):
        ops = diff("same text", "same text")
        assert all(o.op == "equal" for o in ops)


def test_summarize_is_deterministic():
    text = "First sentence here. Second sentence."
    ex = Extraction(frozenset(), frozenset({"family"}))
    assert summarize(text, ex) == summarize(text, ex) == "First sentence here. (Topics: family)"
