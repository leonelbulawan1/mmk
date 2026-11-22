"""Access protocol: the owner's compiled legacy policy.

A ``Protocol`` is an ordered collection of rules (``Grant``, ``Denial``,
``LetterRelease``, ``Group``).  Each rule class knows how to translate itself
into Prolog facts (polymorphic ``to_prolog``).  Once a protocol is frozen (after
the death trigger) it rejects every modification.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Any


def pl_atom(value: str) -> str:
    """Quote *value* as a Prolog atom safely."""
    escaped = (value.replace("\\", "\\\\").replace("'", "\\'")
               .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t"))
    return "'" + escaped + "'"


def pl_date(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


# ---- filters ------------------------------------------------------------------------
@dataclass(frozen=True)
class Filter(ABC):
    @abstractmethod
    def to_prolog(self) -> str: ...

    @abstractmethod
    def describe(self) -> str: ...


@dataclass(frozen=True)
class TopicFilter(Filter):
    topic: str

    def to_prolog(self) -> str:
        return f"topic({pl_atom(self.topic.lower())})"

    def describe(self) -> str:
        return f'about "{self.topic}"'


@dataclass(frozen=True)
class MentionFilter(Filter):
    name: str

    def to_prolog(self) -> str:
        return f"mention({pl_atom(self.name.lower())})"

    def describe(self) -> str:
        return f'mentioning "{self.name}"'


@dataclass(frozen=True)
class FromFilter(Filter):
    since: date

    def to_prolog(self) -> str:
        return f"from({pl_date(self.since)})"

    def describe(self) -> str:
        return f"from {self.since.isoformat()}"


@dataclass(frozen=True)
class UntilFilter(Filter):
    until: date

    def to_prolog(self) -> str:
        return f"until({pl_date(self.until)})"

    def describe(self) -> str:
        return f"until {self.until.isoformat()}"


# ---- conditions -----------------------------------------------------------------------
@dataclass(frozen=True)
class Condition(ABC):
    @abstractmethod
    def to_prolog(self) -> str: ...

    @abstractmethod
    def describe(self) -> str: ...


@dataclass(frozen=True)
class Always(Condition):
    def to_prolog(self) -> str:
        return "always"

    def describe(self) -> str:
        return "immediately"


@dataclass(frozen=True)
class AfterDate(Condition):
    when: date

    def to_prolog(self) -> str:
        return f"date({pl_date(self.when)})"

    def describe(self) -> str:
        return f"after {self.when.isoformat()}"


@dataclass(frozen=True)
class AfterDeath(Condition):
    def to_prolog(self) -> str:
        return "death"

    def describe(self) -> str:
        return "after death"


# ---- rules -----------------------------------------------------------------------------
@dataclass(frozen=True)
class Rule(ABC):
    line: int

    @abstractmethod
    def to_prolog(self, rule_id: int) -> list[str]: ...

    @abstractmethod
    def describe(self) -> str: ...

    def to_dict(self) -> dict[str, Any]:
        return {"type": type(self).__name__.lower(), "line": self.line, "text": self.describe()}


@dataclass(frozen=True)
class Group(Rule):
    name: str
    members: tuple[str, ...]

    def to_prolog(self, rule_id: int) -> list[str]:
        return [f"group_member({pl_atom(self.name)}, {pl_atom(m)})." for m in self.members]

    def describe(self) -> str:
        return f"group {self.name} = {', '.join(self.members)}"


@dataclass(frozen=True)
class Grant(Rule):
    who: str
    level: str
    filters: tuple[Filter, ...] = ()
    condition: Condition = field(default_factory=Always)

    def to_prolog(self, rule_id: int) -> list[str]:
        fs = ", ".join(f.to_prolog() for f in self.filters)
        return [f"rule_grant({rule_id}, {pl_atom(self.who)}, {self.level}, [{fs}], {self.condition.to_prolog()})."]

    def describe(self) -> str:
        fs = " ".join(f.describe() for f in self.filters)
        return f"allow {self.who} {self.level} access to entries {fs} ({self.condition.describe()})".replace("  ", " ")


@dataclass(frozen=True)
class Denial(Rule):
    who: str
    filters: tuple[Filter, ...] = ()

    def to_prolog(self, rule_id: int) -> list[str]:
        fs = ", ".join(f.to_prolog() for f in self.filters)
        return [f"rule_deny({rule_id}, {pl_atom(self.who)}, [{fs}])."]

    def describe(self) -> str:
        fs = " ".join(f.describe() for f in self.filters)
        return f"deny {self.who} access to entries {fs}".strip()


@dataclass(frozen=True)
class LetterRelease(Rule):
    who: str
    condition: Condition

    def to_prolog(self, rule_id: int) -> list[str]:
        return [f"rule_letters({rule_id}, {pl_atom(self.who)}, {self.condition.to_prolog()})."]

    def describe(self) -> str:
        return f"release letters to {self.who} {self.condition.describe()}"


class PolicyFrozenError(PermissionError):
    pass


class Protocol:
    def __init__(self, owner_id: int, rules: tuple[Rule, ...] = (), source: str = "", version: int = 0,
                 frozen: bool = False):
        self._owner_id = owner_id
        self._rules = tuple(rules)
        self._source = source
        self._version = version
        self._frozen = frozen

    owner_id = property(lambda self: self._owner_id)
    rules = property(lambda self: self._rules)
    source = property(lambda self: self._source)
    version = property(lambda self: self._version)
    frozen = property(lambda self: self._frozen)

    def grants(self) -> tuple[Grant, ...]:
        return tuple(r for r in self._rules if isinstance(r, Grant))

    def denials(self) -> tuple[Denial, ...]:
        return tuple(r for r in self._rules if isinstance(r, Denial))

    def freeze(self) -> None:
        self._frozen = True

    def replace(self, rules: tuple[Rule, ...], source: str) -> "Protocol":
        """Return the next version of this protocol.  Frozen protocols refuse."""
        if self._frozen:
            raise PolicyFrozenError("The policy is frozen after the death trigger")
        return Protocol(self._owner_id, rules, source, self._version + 1)

    def to_prolog_facts(self) -> list[str]:
        facts: list[str] = []
        for i, rule in enumerate(self._rules, start=1):
            facts.extend(rule.to_prolog(i))
        if self._frozen:
            facts.append("policy_frozen.")
        return facts
