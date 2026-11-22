"""Abstract syntax tree for the Legacy Policy Language (immutable nodes)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Node:
    line: int


@dataclass(frozen=True)
class FilterNode(Node):
    kind: str  # about | mentioning | from | until
    value: str


@dataclass(frozen=True)
class ConditionNode(Node):
    kind: str  # date | death
    value: str = ""


@dataclass(frozen=True)
class GroupStmt(Node):
    name: str
    members: tuple[str, ...]


@dataclass(frozen=True)
class AllowStmt(Node):
    subject: str
    level: str
    filters: tuple[FilterNode, ...]
    condition: ConditionNode | None


@dataclass(frozen=True)
class DenyStmt(Node):
    subject: str
    filters: tuple[FilterNode, ...]


@dataclass(frozen=True)
class ReleaseStmt(Node):
    subject: str
    condition: ConditionNode


Statement = GroupStmt | AllowStmt | DenyStmt | ReleaseStmt


@dataclass(frozen=True)
class Program(Node):
    statements: tuple[Statement, ...]
