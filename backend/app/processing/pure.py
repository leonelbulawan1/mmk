"""Functional entry processing.

Every function in this module is *pure*: it depends only on its arguments,
never mutates them, performs no I/O and always returns a new immutable value
(``str``, ``tuple``, ``frozenset`` or a frozen dataclass).  That makes the
processing pipeline trivially testable and safe to re-run when verifying the
hash chain.

Pipeline:  raw text --normalize--> text --extract--> (names, topics)
                                      \\--correct--> Correction --diff--> ops
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass
from types import MappingProxyType
from typing import Iterable, Mapping

# --------------------------------------------------------------------------
# Immutable result types
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Extraction:
    names: frozenset[str]
    topics: frozenset[str]

    def as_sorted(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        return tuple(sorted(self.names)), tuple(sorted(self.topics))


@dataclass(frozen=True)
class Change:
    """A single correction applied by :func:`correct`."""

    rule: str
    before: str
    after: str


@dataclass(frozen=True)
class Correction:
    original: str
    text: str
    changes: tuple[Change, ...]

    @property
    def changed(self) -> bool:
        return self.original != self.text


@dataclass(frozen=True)
class DiffOp:
    """One word-level edit operation: ``equal``, ``insert``, ``delete`` or ``replace``."""

    op: str
    before: str
    after: str

    def to_dict(self) -> dict:
        return {"op": self.op, "before": self.before, "after": self.after}


# --------------------------------------------------------------------------
# Lexicons (read-only mappings)
# --------------------------------------------------------------------------

TOPIC_LEXICON: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {
        "family": ("family", "mother", "father", "mom", "dad", "mama", "papa", "lola", "lolo",
                   "sister", "brother", "daughter", "son", "kids", "children", "grandchild", "cousin", "tita", "tito"),
        "work": ("work", "office", "job", "boss", "project", "meeting", "career", "salary", "colleague", "promotion"),
        "health": ("health", "doctor", "hospital", "sick", "medicine", "fever", "checkup", "illness", "surgery", "diagnosis"),
        "travel": ("travel", "trip", "flight", "beach", "vacation", "journey", "airport", "visit", "province"),
        "love": ("love", "wedding", "married", "anniversary", "romance", "boyfriend", "girlfriend", "husband", "wife"),
        "faith": ("church", "mass", "pray", "prayer", "faith", "god", "blessing", "novena"),
        "money": ("money", "debt", "loan", "savings", "bank", "budget", "inheritance", "bills", "investment"),
        "school": ("school", "class", "teacher", "exam", "graduation", "university", "college", "thesis", "student"),
        "food": ("food", "cook", "cooking", "recipe", "dinner", "lunch", "breakfast", "adobo", "sinigang", "bake"),
        "friendship": ("friend", "friends", "barkada", "friendship", "bestfriend"),
        "home": ("home", "house", "garden", "neighbor", "kitchen", "moved"),
        "grief": ("grief", "funeral", "passed", "died", "loss", "mourning", "wake"),
    }
)

COMMON_TYPOS: Mapping[str, str] = MappingProxyType(
    {
        "teh": "the", "recieve": "receive", "recieved": "received", "definately": "definitely",
        "seperate": "separate", "occured": "occurred", "untill": "until", "wich": "which",
        "becuase": "because", "beacuse": "because", "tommorow": "tomorrow", "tomorow": "tomorrow",
        "freind": "friend", "freinds": "friends", "alot": "a lot", "goverment": "government",
        "beleive": "believe", "wierd": "weird", "thier": "their", "truely": "truly",
        "acheive": "achieve", "begining": "beginning", "embarass": "embarrass", "dont": "don't",
        "cant": "can't", "wont": "won't", "didnt": "didn't", "im": "I'm", "ive": "I've",
        "isnt": "isn't", "wasnt": "wasn't", "couldnt": "couldn't", "wouldnt": "wouldn't",
    }
)

# Capitalised words that are not personal names.
_NAME_STOPWORDS: frozenset[str] = frozenset(
    """I I'm I've I'd I'll The A An And But Or So Then When While Today Tomorrow Yesterday
    Monday Tuesday Wednesday Thursday Friday Saturday Sunday Mondays Tuesdays Wednesdays
    Thursdays Fridays Saturdays Sundays January February March April May
    June July August September October November December God Lord Christmas Easter It This That
    We He She They My Our Your His Her Their After Before Dear Love Mom Dad Mama Papa Lola Lolo
    Tita Tito Ate Kuya Philippines Manila Sorsogon Legazpi Albay Bicol Maybe Also Still Just""".split()
)

_SMART_PUNCT = MappingProxyType(
    {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": " - ", " ": " "}
)

# --------------------------------------------------------------------------
# normalize
# --------------------------------------------------------------------------


def normalize(text: str) -> str:
    """Return a canonical form of *text*.

    * Unicode NFC normalisation
    * smart quotes / dashes / NBSP -> ASCII equivalents
    * CRLF -> LF, trailing whitespace stripped per line
    * runs of spaces/tabs collapsed to one space
    * at most one blank line between paragraphs
    """
    t = unicodedata.normalize("NFC", text)
    t = "".join(_SMART_PUNCT.get(ch, ch) for ch in t)
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    lines = tuple(re.sub(r"[ \t]+", " ", line).strip() for line in t.split("\n"))
    t = "\n".join(lines)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


# --------------------------------------------------------------------------
# extract
# --------------------------------------------------------------------------

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
_HASHTAG_RE = re.compile(r"#([A-Za-z][A-Za-z0-9_\-]*)")


def _sentence_initial_positions(text: str) -> frozenset[int]:
    starts = {0}
    for m in re.finditer(r"[.!?]\s+|\n+", text):
        starts.add(m.end())
    return frozenset(starts)


def extract(text: str, known_names: Iterable[str] = ()) -> Extraction:
    """Extract personal names and topics from *text* (already normalised).

    Names: words from *known_names* (case-insensitive) plus capitalised words that
    are not sentence-initial and not stop-words.  Topics: lexicon matches plus
    explicit ``#hashtags``.
    """
    known = {n.lower(): n for n in known_names if n}
    starts = _sentence_initial_positions(text)
    names: set[str] = set()
    lowered_words: set[str] = set()
    for m in _WORD_RE.finditer(text):
        word = m.group(0).strip("'-")
        if not word:
            continue
        lowered_words.add(word.lower())
        if word.lower() in known:
            names.add(known[word.lower()])
        elif word[0].isupper() and m.start() not in starts and word not in _NAME_STOPWORDS and len(word) > 1:
            names.add(word)
    topics = {topic for topic, keys in TOPIC_LEXICON.items() if any(k in lowered_words for k in keys)}
    topics |= {h.lower() for h in _HASHTAG_RE.findall(text)}
    return Extraction(names=frozenset(names), topics=frozenset(topics))


# --------------------------------------------------------------------------
# correct
# --------------------------------------------------------------------------


def _apply(rule: str, pattern: str, repl, text: str, flags: int = 0) -> tuple[str, tuple[Change, ...]]:
    changes: list[Change] = []

    def _sub(m: re.Match) -> str:
        new = repl(m) if callable(repl) else m.expand(repl)
        if new != m.group(0):
            changes.append(Change(rule, m.group(0), new))
        return new

    return re.sub(pattern, _sub, text, flags=flags), tuple(changes)


def _fix_typo(m: re.Match) -> str:
    word = m.group(0)
    fixed = COMMON_TYPOS.get(word.lower())
    if fixed is None:
        return word
    if word[0].isupper() and fixed[0].islower():
        fixed = fixed[0].upper() + fixed[1:]
    return fixed


def correct(text: str) -> Correction:
    """Apply light, conservative corrections and report every change.

    Rules (in order): common typos, standalone lowercase "i", repeated words,
    space before punctuation, missing space after punctuation, sentence capitalisation,
    double spaces.  Meaning is never altered.
    """
    original = text
    steps = (
        ("typo", r"\b[A-Za-z]+\b", _fix_typo, 0),
        ("pronoun-i", r"(?<![A-Za-z'])i(?=[ ,.!?']|$)", lambda m: "I", 0),
        ("repeated-word", r"\b([A-Za-z]+)\s+\1\b", lambda m: m.group(1), re.IGNORECASE),
        ("space-before-punct", r"\s+([,.!?;:])", lambda m: m.group(1), 0),
        ("space-after-punct", r"([,;:!?])(?=[A-Za-z])", lambda m: m.group(1) + " ", 0),
        ("sentence-case", r"(^|[.!?]\s+|\n)([a-z])", lambda m: m.group(1) + m.group(2).upper(), 0),
        ("double-space", r" {2,}", lambda m: " ", 0),
    )
    all_changes: tuple[Change, ...] = ()
    for rule, pattern, repl, flags in steps:
        text, ch = _apply(rule, pattern, repl, text, flags)
        all_changes = all_changes + ch
    return Correction(original=original, text=text, changes=all_changes)


# --------------------------------------------------------------------------
# diff
# --------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"\s+|[^\s]+")


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN_RE.findall(text))


def diff(before: str, after: str) -> tuple[DiffOp, ...]:
    """Word-level diff of two texts as an immutable tuple of :class:`DiffOp`."""
    a, b = _tokens(before), _tokens(after)
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    return tuple(
        DiffOp(tag, "".join(a[i1:i2]), "".join(b[j1:j2])) for tag, i1, i2, j1, j2 in matcher.get_opcodes()
    )


def apply_diff(ops: Iterable[DiffOp]) -> str:
    """Reconstruct the *after* text from diff ops (inverse check for :func:`diff`)."""
    return "".join(op.after if op.op != "equal" else op.before for op in ops)


def revert_diff(ops: Iterable[DiffOp]) -> str:
    """Reconstruct the *before* text from diff ops."""
    return "".join(op.before for op in ops)


# --------------------------------------------------------------------------
# summarize (used to pre-compute summary-level access content)
# --------------------------------------------------------------------------


def summarize(text: str, extraction: Extraction, max_chars: int = 160) -> str:
    """Deterministic, extractive summary: the first sentence (truncated) plus topics.

    Summaries are computed at write time on the owner's side, so summary-level
    access never requires sending verbatim text anywhere.
    """
    first = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)[0] if text.strip() else ""
    if len(first) > max_chars:
        first = first[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    topics = ", ".join(sorted(extraction.topics))
    return f"{first} (Topics: {topics})" if topics else first
