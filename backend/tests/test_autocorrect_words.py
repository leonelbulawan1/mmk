"""The shared correction list (used by Light Fix on the server and by auto-correct in the browser)."""
import json
from pathlib import Path

from app.processing.pure import COMMON_PHRASES, COMMON_TYPOS, correct

LIST = Path(__file__).parents[1] / "app" / "processing" / "typos.json"


def test_spelling_and_grammar_are_fixed():
    out = correct("i could of went to teh beach becuase it was beutiful . we went went home").text
    assert out == "I could have went to the beach because it was beautiful. We went home"


def test_the_list_has_no_entries_that_change_nothing_or_real_words():
    data = json.loads(LIST.read_text())
    assert all(k.lower() != v.lower() for k, v in data["words"].items())
    for real in ("lets", "hes", "shes", "ill", "its", "were", "your", "then"):
        assert real not in COMMON_TYPOS
    assert COMMON_PHRASES["could of"] == "could have"


def test_the_website_uses_the_same_list():
    js = (Path(__file__).parents[2] / "frontend" / "src" / "autocorrect.js").read_text()
    assert "backend/app/processing/typos.json" in js
