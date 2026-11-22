"""Tools exposed to the language model.

Security design
---------------
``AuthorizedContext`` is built from (a) the Prolog decisions for one beneficiary
and (b) the owner's vault.  At construction it renders each entry *at its
authorised level* and immediately discards the full entry objects.  From then on
the AI layer can only ever see these pre-filtered views:

* ``none``       -> the entry is absent entirely (indistinguishable from not existing)
* ``existence``  -> id + date + kind only
* ``summary``    -> + write-time summary and topics
* ``verbatim``   -> + title and text

The access decision therefore happens *before* any content is retrieved for AI
processing, and unauthorised content is never in memory reachable by the model.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable

from ..domain.entries import Entry, level_rank
from ..prolog.engine import Decision

NOT_AVAILABLE = {"available": False, "message": "This entry is not available."}

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "name": "search_entries",
        "description": ("Search the diary entries this person is allowed to see. Returns entry ids, dates and the "
                        "access level only - no content. Use get_entry to read an entry."),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords, names, topics or a year/month like 2019 or 2019-05."},
                "from_date": {"type": "string", "description": "Optional earliest entry date, YYYY-MM-DD."},
                "to_date": {"type": "string", "description": "Optional latest entry date, YYYY-MM-DD."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "check_access",
        "description": "Return the access level (none, existence, summary, verbatim) for an entry id.",
        "input_schema": {"type": "object", "properties": {"entry_id": {"type": "integer"}}, "required": ["entry_id"]},
    },
    {
        "name": "entries_about_me",
        "description": ("Use when the person asks whether the diary mentions them or how often the owner wrote about "
                        "them. Returns only how many of the entries they may see mention them, and their dates. "
                        "It never returns content."),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "my_letters",
        "description": ("Letters the owner addressed to this person. A released letter includes its full text, which "
                        "may be quoted. A letter that is not released yet includes only its title and, if known, the "
                        "date it opens: say it is not released yet and never guess its content."),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_entry",
        "description": ("Retrieve an entry at the level this person is authorised for. Existence level returns only "
                        "the date; summary returns a short summary; verbatim returns the text."),
        "input_schema": {"type": "object", "properties": {"entry_id": {"type": "integer"}}, "required": ["entry_id"]},
    },
]

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset("the a an of to and or in on at for with about did does do was were is are what when who how why "
                  "my your her his their mom dad she he they it me i you tell any anything know there".split())


def _terms(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


_SUFFIXES = ("ings", "ing", "edly", "ed", "es", "s", "ly")


def stem(word: str) -> str:
    """Very small English stemmer so cook / cooked / cooking / cooks match each other."""
    for suf in _SUFFIXES:
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[: -len(suf)]
    return word


def stems(words) -> set[str]:
    return {stem(w) for w in words}


@dataclass
class AuthorizedContext:
    handle: str
    views: dict[int, dict[str, Any]] = field(default_factory=dict)
    # Entries (among the authorised ones) that mention the asker: id/date/access only. None = name is ambiguous.
    about_me: list[dict[str, Any]] | None = field(default_factory=list)
    # Letters addressed to the asker: released ones carry their text; sealed ones only title + opening date.
    letters: list[dict[str, Any]] = field(default_factory=list)
    retrieved: dict[int, dict[str, Any]] = field(default_factory=dict)  # what get_entry actually returned
    trace: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def build(cls, handle: str, entries: Iterable[Entry], decisions: dict[int, Decision],
              asker_names: set[str] | None = frozenset(), letters: list[dict[str, Any]] | None = None) -> "AuthorizedContext":
        """``asker_names``: lower-case names that refer to the asker (None when the name is ambiguous).
        ``letters``: the asker's own letters, already decided by Prolog (see qa_service.letters_for)."""
        views: dict[int, dict[str, Any]] = {}
        about_me: list[dict[str, Any]] | None = [] if asker_names is not None else None
        for e in entries:
            if e.kind == "letter":
                continue  # letters only reach their recipient, through my_letters
            d = decisions.get(int(e.id))
            level = d.level if d else "none"  # fail closed
            if level_rank(level) >= 1:
                view = e.render(level)
                if view:
                    views[int(e.id)] = view
                    # Mentions are checked while the full entry is in hand; only id/date/access are kept.
                    if about_me is not None and asker_names and {n.lower() for n in e.extraction.names} & asker_names:
                        about_me.append({"entry_id": int(e.id), "date": view["date"], "access": level})
        if about_me is not None:
            about_me.sort(key=lambda x: x["date"])
        return cls(handle=handle, views=views, about_me=about_me, letters=list(letters or []))

    @property
    def has_any(self) -> bool:
        return bool(self.views) or bool(self.letters)

    # ---- tool implementations ------------------------------------------------------------
    def search_entries(self, query: str, from_date: str | None = None, to_date: str | None = None) -> dict:
        terms = _terms(query or "")
        date_terms = set(re.findall(r"\b(\d{4}(?:-\d{2}){0,2})\b", query or ""))
        try:
            lo = date.fromisoformat(from_date) if from_date else None
            hi = date.fromisoformat(to_date) if to_date else None
        except ValueError:
            return {"error": "Dates must be YYYY-MM-DD."}
        scored = []
        for eid, v in self.views.items():
            d = date.fromisoformat(v["date"])
            if (lo and d < lo) or (hi and d > hi):
                continue
            score = sum(3 for t in date_terms if v["date"].startswith(t))
            # Only the content the person may see is searchable (existence views have none).
            searchable = " ".join(str(v.get(k, "")) for k in ("title", "text", "summary")) + " " + " ".join(v.get("topics", []))
            words = stems(_WORD.findall(searchable.lower()))
            score += sum(2 if t in v.get("topics", []) else 1 for t in terms if stem(t) in words)
            if score > 0 or (not terms and not date_terms):
                scored.append((score, v["date"], eid, v["access"]))
        scored.sort(key=lambda x: (-x[0], x[1]))
        results = [{"entry_id": eid, "date": dt, "access": acc} for _, dt, eid, acc in scored[:8]]
        return {"results": results, "count": len(results)}

    def check_access(self, entry_id: int) -> dict:
        v = self.views.get(_as_int(entry_id))
        return {"entry_id": entry_id, "access": v["access"] if v else "none"}

    def get_entry(self, entry_id: int) -> dict:
        eid = _as_int(entry_id)
        v = self.views.get(eid)
        if v is None:
            return dict(NOT_AVAILABLE)
        self.retrieved[eid] = v
        return dict(v)

    def entries_about_me(self) -> dict:
        if self.about_me is None:  # AmbiguousName: never guess who is meant
            return {"count": 0, "dates": [], "note": "The asker's name is ambiguous, so mentions cannot be counted."}
        return {"count": len(self.about_me), "dates": [m["date"] for m in self.about_me],
                "readable": sum(1 for m in self.about_me if m["access"] in ("summary", "verbatim"))}

    def my_letters(self) -> dict:
        out = []
        for letter in self.letters:
            if letter["status"] == "released":
                self.retrieved[letter["entry_id"]] = {**letter, "access": "verbatim"}
            out.append(dict(letter))
        return {"letters": out, "count": len(out)}

    def call(self, name: str, args: dict) -> dict:
        fn = {"search_entries": self.search_entries, "check_access": self.check_access,
              "get_entry": self.get_entry, "entries_about_me": self.entries_about_me,
              "my_letters": self.my_letters}.get(name)
        if fn is None:
            result = {"error": f"Unknown tool {name}"}
        else:
            try:
                result = fn(**(args or {}))
            except TypeError:
                result = {"error": "Invalid arguments"}
        self.trace.append({"tool": name, "args": args})
        return result


def _as_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return -1
