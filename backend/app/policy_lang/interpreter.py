"""Interpreter: walks the AST, checks semantics and builds a domain ``Protocol``.

Semantic rules enforced here:
* every subject must be a registered beneficiary handle, a group defined *earlier*, or ``everyone``;
* group names must be unique and must not shadow a beneficiary handle;
* group members must be registered beneficiaries;
* dates must be real calendar dates; ``from`` must not be later than ``until``;
* a scope may contain at most one ``from`` and one ``until``.
Warnings (non-fatal) are produced for topics outside the known vocabulary and
for allow statements that a later/earlier deny makes ineffective for everyone.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ..domain.protocol import (AfterDate, AfterDeath, Always, Condition, Denial, Filter, FromFilter, Grant, Group,
                               LetterRelease, MentionFilter, Protocol, Rule, TopicFilter, UntilFilter)
from ..processing.pure import TOPIC_LEXICON
from .ast import AllowStmt, ConditionNode, DenyStmt, FilterNode, GroupStmt, Program, ReleaseStmt
from .lexer import PolicySyntaxError
from .parser import parse


@dataclass
class CompileResult:
    ok: bool
    protocol: Protocol | None
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    prolog: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": self.errors,
            "warnings": self.warnings,
            "rules": [r.to_dict() for r in self.protocol.rules] if self.protocol else [],
            "prolog": self.prolog,
        }


class SemanticError(PolicySyntaxError):
    pass


class Interpreter:
    def __init__(self, beneficiaries: set[str]):
        self._beneficiaries = set(beneficiaries)
        self._groups: dict[str, tuple[str, ...]] = {}
        self.errors: list[PolicySyntaxError] = []
        self.warnings: list[dict] = []

    # ---- helpers ----------------------------------------------------------------------
    def _err(self, msg: str, line: int) -> None:
        self.errors.append(SemanticError(msg, line, 1))

    def _subject(self, name: str, line: int) -> bool:
        if name == "everyone" or name in self._beneficiaries or name in self._groups:
            return True
        self._err(f"unknown beneficiary or group '{name}'", line)
        return False

    def _date(self, text: str, line: int) -> date | None:
        try:
            return date.fromisoformat(text)
        except ValueError:
            self._err(f"'{text}' is not a valid calendar date", line)
            return None

    def _filters(self, nodes: tuple[FilterNode, ...], line: int) -> tuple[Filter, ...] | None:
        out: list[Filter] = []
        seen: set[str] = set()
        since = until = None
        ok = True
        for f in nodes:
            if f.kind in ("from", "until"):
                if f.kind in seen:
                    self._err(f"'{f.kind}' may appear only once per statement", f.line)
                    ok = False
                    continue
                seen.add(f.kind)
                d = self._date(f.value, f.line)
                if d is None:
                    ok = False
                    continue
                if f.kind == "from":
                    since = d
                    out.append(FromFilter(d))
                else:
                    until = d
                    out.append(UntilFilter(d))
            elif f.kind == "about":
                topic = f.value.lower()
                if topic not in TOPIC_LEXICON:
                    self.warnings.append({"line": f.line, "message":
                                          f'topic "{f.value}" is not in the built-in vocabulary; it will only '
                                          f'match entries tagged #{topic}'})
                out.append(TopicFilter(topic))
            else:
                out.append(MentionFilter(f.value.lower()))
        if since and until and since > until:
            self._err("'from' date is later than 'until' date", line)
            ok = False
        return tuple(out) if ok else None

    def _condition(self, node: ConditionNode | None) -> Condition | None:
        if node is None:
            return Always()
        if node.kind == "death":
            return AfterDeath()
        d = self._date(node.value, node.line)
        return AfterDate(d) if d else None

    # ---- statement visitors (dispatch on node type) ---------------------------------
    def visit(self, stmt) -> Rule | None:
        method = getattr(self, f"visit_{type(stmt).__name__}")
        return method(stmt)

    def visit_GroupStmt(self, s: GroupStmt) -> Rule | None:
        if s.name in self._groups:
            self._err(f"group '{s.name}' is already defined", s.line)
            return None
        if s.name in self._beneficiaries:
            self._err(f"group name '{s.name}' clashes with a beneficiary", s.line)
            return None
        unknown = [m for m in s.members if m not in self._beneficiaries]
        if unknown:
            self._err(f"unknown beneficiar{'y' if len(unknown) == 1 else 'ies'}: {', '.join(unknown)}", s.line)
            return None
        members = tuple(dict.fromkeys(s.members))
        self._groups[s.name] = members
        return Group(s.line, s.name, members)

    def visit_AllowStmt(self, s: AllowStmt) -> Rule | None:
        ok = self._subject(s.subject, s.line)
        filters = self._filters(s.filters, s.line)
        cond = self._condition(s.condition)
        if not ok or filters is None or cond is None:
            return None
        return Grant(s.line, s.subject, s.level, filters, cond)

    def visit_DenyStmt(self, s: DenyStmt) -> Rule | None:
        ok = self._subject(s.subject, s.line)
        filters = self._filters(s.filters, s.line)
        if not ok or filters is None:
            return None
        return Denial(s.line, s.subject, filters)

    def visit_ReleaseStmt(self, s: ReleaseStmt) -> Rule | None:
        ok = self._subject(s.subject, s.line)
        cond = self._condition(s.condition)
        if not ok or cond is None:
            return None
        return LetterRelease(s.line, s.subject, cond)

    def run(self, program: Program) -> tuple[Rule, ...]:
        rules = [r for r in (self.visit(s) for s in program.statements) if r is not None]
        # Warn about grants made unreachable by a blanket deny on the same subject.
        blanket = {r.who for r in rules if isinstance(r, Denial) and not r.filters}
        for r in rules:
            if isinstance(r, Grant) and (r.who in blanket or "everyone" in blanket):
                self.warnings.append({"line": r.line, "message":
                                      "this allow has no effect: a deny on all entries overrides it"})
        return tuple(rules)


def compile_policy(source: str, beneficiaries: set[str], owner_id: int = 0) -> CompileResult:
    """Lex, parse, interpret and translate *source* to Prolog facts."""
    program, syntax_errors = parse(source)
    if program is None or syntax_errors:
        return CompileResult(False, None, [e.to_dict() for e in syntax_errors])
    interp = Interpreter(beneficiaries)
    rules = interp.run(program)
    if interp.errors:
        return CompileResult(False, None, [e.to_dict() for e in interp.errors], interp.warnings)
    protocol = Protocol(owner_id, rules, source)
    return CompileResult(True, protocol, [], interp.warnings, protocol.to_prolog_facts())
