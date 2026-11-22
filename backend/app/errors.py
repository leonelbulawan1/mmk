"""Typed failures the system raises, and the safe action taken for each.

| Exception           | Raised when                                              | Safe action                         |
|---------------------|----------------------------------------------------------|-------------------------------------|
| AccessDenied        | someone asks for an entry/letter Prolog does not allow   | answer exactly like "not found"     |
| AmbiguousName       | a name could mean more than one beneficiary              | do not guess; share nothing about it|
| TamperDetected      | a hash chain no longer matches its records               | stop releasing content (fail closed)|
| PolicySyntaxError   | a policy program does not lex/parse/check                | keep the previous policy version    |
"""
from __future__ import annotations

from .policy_lang.lexer import PolicySyntaxError


class AlaalaError(Exception):
    """Base class for the system's own typed failures."""


class AccessDenied(AlaalaError, PermissionError):
    """The asker may not see this entry or letter. Callers must not reveal whether it exists."""


class AmbiguousName(AlaalaError, LookupError):
    """A name matches more than one person, so it cannot safely be attributed to one of them."""

    def __init__(self, name: str, matches: list[str]):
        super().__init__(f"The name {name!r} matches more than one person")
        self.name = name
        self.matches = matches


class TamperDetected(AlaalaError, RuntimeError):
    """A stored record no longer matches its hash chain."""

    def __init__(self, chain: str, position: int | None = None):
        where = f" at record {position}" if position is not None else ""
        super().__init__(f"The {chain} hash chain does not verify{where}")
        self.chain = chain
        self.position = position


__all__ = ["AlaalaError", "AccessDenied", "AmbiguousName", "TamperDetected", "PolicySyntaxError"]
