"""Diary entries.

``Entry`` is an abstract base class; ``TextEntry`` and ``LetterEntry`` override
``kind``, ``hash_payload`` and ``render`` (polymorphism).  Entries are immutable
after construction: every attribute is private and exposed only via read-only
properties (encapsulation).  Corrections never overwrite an entry; they are
appended as :class:`Revision` objects.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from ..processing.pure import Extraction

ACCESS_LEVELS = ("none", "existence", "summary", "verbatim")


def level_rank(level: str) -> int:
    return ACCESS_LEVELS.index(level) if level in ACCESS_LEVELS else 0


@dataclass(frozen=True)
class Revision:
    """An appended correction of an entry.  The original is never changed."""

    id: int | None
    entry_id: int
    seq: int
    text: str
    source: str  # "light_fix" | "review"
    created_at: datetime
    prev_hash: str = ""
    hash: str = ""

    def hash_payload(self, entry_seq: int) -> dict[str, Any]:
        return {
            "kind": "revision",
            "entry_seq": entry_seq,
            "seq": self.seq,
            "text": self.text,
            "source": self.source,
            "created_at": self.created_at.isoformat(),
        }


class Entry(ABC):
    def __init__(self, *, entry_id: int | None, owner_id: int, seq: int, title: str, original_text: str,
                 entry_date: date, created_at: datetime, writing_mode: str, extraction: Extraction,
                 summary: str, prev_hash: str = "", hash: str = "", revisions: tuple[Revision, ...] = ()):
        if not original_text.strip():
            raise ValueError("An entry cannot be empty")
        self._id = entry_id
        self._owner_id = owner_id
        self._seq = seq
        self._title = title.strip()
        self._original_text = original_text
        self._entry_date = entry_date
        self._created_at = created_at
        self._writing_mode = writing_mode
        self._extraction = extraction
        self._summary = summary
        self._prev_hash = prev_hash
        self._hash = hash
        self._revisions = tuple(revisions)

    # ---- read-only state -------------------------------------------------
    id = property(lambda self: self._id)
    owner_id = property(lambda self: self._owner_id)
    seq = property(lambda self: self._seq)
    title = property(lambda self: self._title)
    original_text = property(lambda self: self._original_text)
    entry_date = property(lambda self: self._entry_date)
    created_at = property(lambda self: self._created_at)
    writing_mode = property(lambda self: self._writing_mode)
    extraction = property(lambda self: self._extraction)
    summary = property(lambda self: self._summary)
    prev_hash = property(lambda self: self._prev_hash)
    hash = property(lambda self: self._hash)
    revisions = property(lambda self: self._revisions)

    @property
    def current_text(self) -> str:
        """Display text: the latest appended revision, or the original."""
        return self._revisions[-1].text if self._revisions else self._original_text

    def with_revision(self, revision: Revision) -> "Entry":
        """Return a *new* entry object that includes *revision* (original untouched)."""
        clone = object.__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone._revisions = self._revisions + (revision,)
        return clone

    def sealed(self, prev_hash: str, hash_: str) -> "Entry":
        clone = object.__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone._prev_hash, clone._hash = prev_hash, hash_
        return clone

    # ---- polymorphic behaviour ------------------------------------------
    @property
    @abstractmethod
    def kind(self) -> str: ...

    def hash_payload(self) -> dict[str, Any]:
        names, topics = self._extraction.as_sorted()
        return {
            "kind": self.kind,
            "owner_id": self._owner_id,
            "seq": self._seq,
            "title": self._title,
            "original_text": self._original_text,
            "entry_date": self._entry_date.isoformat(),
            "created_at": self._created_at.isoformat(),
            "writing_mode": self._writing_mode,
            "names": list(names),
            "topics": list(topics),
            "summary": self._summary,
        }

    def render(self, level: str) -> dict[str, Any] | None:
        """Return only what *level* permits.  ``none`` returns ``None``."""
        if level_rank(level) < 1:
            return None
        out: dict[str, Any] = {"entry_id": self._id, "date": self._entry_date.isoformat(),
                               "kind": self.kind, "access": level}
        if level_rank(level) >= 2:
            out["summary"] = self._summary
            out["topics"] = sorted(self._extraction.topics)
        if level_rank(level) >= 3:
            out["title"] = self._title
            out["text"] = self.current_text
        return out


class TextEntry(Entry):
    @property
    def kind(self) -> str:
        return "text"


class LetterEntry(Entry):
    """A letter addressed to one beneficiary, released on a date and/or after death."""

    def __init__(self, *, recipient_handle: str, release_on: date | None, release_on_death: bool,
                 deliver_while_alive: bool = False, release_days_after_death: int | None = None, **kw):
        if release_on is None and not release_on_death:
            raise ValueError("A letter needs a release date or release-on-death")
        if deliver_while_alive and (release_on is None or release_on_death):
            raise ValueError("Only a letter that opens on a date can be delivered while the owner is alive")
        super().__init__(**kw)
        self._recipient_handle = recipient_handle
        self._release_on = release_on
        self._release_on_death = release_on_death
        self._deliver_while_alive = bool(deliver_while_alive)
        if release_days_after_death is not None and (not release_on_death or not 1 <= release_days_after_death <= 36500):
            raise ValueError("'Days after death' needs a letter that opens after death, and 1 to 36500 days")
        self._release_days_after_death = release_days_after_death or None

    recipient_handle = property(lambda self: self._recipient_handle)
    release_on = property(lambda self: self._release_on)
    release_on_death = property(lambda self: self._release_on_death)
    # The owner's own explicit release: the letter opens on its date even while the owner is alive.
    deliver_while_alive = property(lambda self: self._deliver_while_alive)
    release_days_after_death = property(lambda self: self._release_days_after_death)

    @property
    def kind(self) -> str:
        return "letter"

    def hash_payload(self) -> dict[str, Any]:
        payload = super().hash_payload()
        payload.update(
            recipient=self._recipient_handle,
            release_on=self._release_on.isoformat() if self._release_on else None,
            release_on_death=self._release_on_death,
        )
        if self._deliver_while_alive:  # only present when set, so older letters keep their hashes
            payload["deliver_while_alive"] = True
        if self._release_days_after_death:
            payload["release_days_after_death"] = self._release_days_after_death
        return payload

    def render(self, level: str) -> dict[str, Any] | None:
        # Letters are all-or-nothing: either released in full to their recipient or hidden.
        if level != "verbatim":
            return None
        return {"entry_id": self._id, "date": self._entry_date.isoformat(), "kind": "letter",
                "title": self._title, "text": self.current_text, "recipient": self._recipient_handle}
