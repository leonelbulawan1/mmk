"""Object-oriented writing modes.

The service layer never branches on the mode name: it asks the registry for a
``WritingMode`` object and calls ``process``.  Each subclass decides what to do
with the (always preserved) original text:

* ``VerbatimMode``  - keep exactly what was written; no revision.
* ``LightFixMode``  - apply conservative corrections automatically as an appended revision.
* ``ReviewMode``    - compute suggestions only; the owner accepts or ignores them later.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from .processing.pure import Correction, DiffOp, correct, diff


@dataclass(frozen=True)
class ModeResult:
    mode: str
    original: str
    revision_text: str | None  # text to append as a revision now (None = nothing to append)
    suggestions: tuple[DiffOp, ...]  # proposed edits awaiting review
    changes: tuple  # Change records explaining each correction

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "original": self.original,
            "revision_text": self.revision_text,
            "suggestions": [s.to_dict() for s in self.suggestions],
            "changes": [c.__dict__ for c in self.changes],
            "pending_review": bool(self.suggestions) and self.revision_text is None,
        }


class WritingMode(ABC):
    key: str = ""
    label: str = ""
    description: str = ""

    @abstractmethod
    def process(self, original: str) -> ModeResult: ...

    def describe(self) -> dict:
        return {"key": self.key, "label": self.label, "description": self.description}


class VerbatimMode(WritingMode):
    key = "verbatim"
    label = "Verbatim"
    description = "Your words are kept exactly as written. No corrections are made."

    def process(self, original: str) -> ModeResult:
        return ModeResult(self.key, original, None, (), ())


class LightFixMode(WritingMode):
    key = "light_fix"
    label = "Light Fix"
    description = ("Common typos, spacing and capitalisation are fixed automatically. "
                   "The original is preserved and the fix is stored as a separate revision.")

    def process(self, original: str) -> ModeResult:
        c: Correction = correct(original)
        if not c.changed:
            return ModeResult(self.key, original, None, (), ())
        return ModeResult(self.key, original, c.text, (), c.changes)


class ReviewMode(WritingMode):
    key = "review"
    label = "Review"
    description = ("Suggested corrections are shown side by side. Nothing changes until you accept them; "
                   "the original is always kept.")

    def process(self, original: str) -> ModeResult:
        c = correct(original)
        if not c.changed:
            return ModeResult(self.key, original, None, (), ())
        ops = tuple(op for op in diff(original, c.text))
        return ModeResult(self.key, original, None, ops, c.changes)


_REGISTRY: dict[str, WritingMode] = {m.key: m for m in (VerbatimMode(), LightFixMode(), ReviewMode())}


def get_mode(key: str) -> WritingMode:
    try:
        return _REGISTRY[key]
    except KeyError:
        raise ValueError(f"Unknown writing mode '{key}'") from None


def all_modes() -> list[dict]:
    return [m.describe() for m in _REGISTRY.values()]
