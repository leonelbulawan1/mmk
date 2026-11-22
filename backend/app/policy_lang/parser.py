"""Recursive-descent parser for the Legacy Policy Language.

One method per grammar rule (see grammar.ebnf).  On a syntax error the parser
records it, skips to the next ';' (panic-mode recovery) and continues, so the
editor can show every error in one pass.
"""
from __future__ import annotations

from .ast import AllowStmt, ConditionNode, DenyStmt, FilterNode, GroupStmt, Program, ReleaseStmt
from .lexer import PolicySyntaxError, Token, tokenize

LEVELS = ("existence", "summary", "verbatim")
FILTER_KEYWORDS = ("about", "mentioning", "from", "until")


class Parser:
    def __init__(self, tokens: list[Token]):
        self._tokens = tokens
        self._pos = 0
        self.errors: list[PolicySyntaxError] = []

    # ---- token helpers ------------------------------------------------------------
    @property
    def _cur(self) -> Token:
        return self._tokens[self._pos]

    def _advance(self) -> Token:
        tok = self._cur
        if tok.kind != "EOF":
            self._pos += 1
        return tok

    def _check(self, kind: str, value: str | None = None) -> bool:
        tok = self._cur
        return tok.kind == kind and (value is None or tok.value == value)

    def _expect(self, kind: str, value: str | None = None, what: str | None = None) -> Token:
        if self._check(kind, value):
            return self._advance()
        expected = what or (f"'{value}'" if value else kind.lower())
        got = "end of input" if self._cur.kind == "EOF" else f"'{self._cur.value}'"
        raise PolicySyntaxError(f"expected {expected} but found {got}", self._cur.line, self._cur.col)

    def _synchronize(self) -> None:
        while not self._check("EOF") and not self._check("SEMI"):
            self._advance()
        if self._check("SEMI"):
            self._advance()

    # ---- grammar rules ---------------------------------------------------------------
    def program(self) -> Program:
        statements = []
        while not self._check("EOF"):
            try:
                statements.append(self.statement())
            except PolicySyntaxError as err:
                self.errors.append(err)
                self._synchronize()
        return Program(line=1, statements=tuple(statements))

    def statement(self):
        tok = self._cur
        if tok.kind == "KEYWORD":
            handler = {"group": self.group_stmt, "allow": self.allow_stmt,
                       "deny": self.deny_stmt, "release": self.release_stmt}.get(tok.value)
            if handler:
                return handler()
        raise PolicySyntaxError(
            f"a statement must start with group, allow, deny or release (found '{tok.value}')", tok.line, tok.col)

    def group_stmt(self) -> GroupStmt:
        start = self._expect("KEYWORD", "group")
        name = self._expect("IDENT", what="a group name").value
        self._expect("EQUALS", what="'='")
        members = [self._expect("IDENT", what="a beneficiary name").value]
        while self._check("COMMA"):
            self._advance()
            members.append(self._expect("IDENT", what="a beneficiary name").value)
        self._expect("SEMI", what="';'")
        return GroupStmt(start.line, name, tuple(members))

    def allow_stmt(self) -> AllowStmt:
        start = self._expect("KEYWORD", "allow")
        subject = self.subject()
        level = self.level()
        self._expect("KEYWORD", "access")
        self._expect("KEYWORD", "to")
        filters = self.scope()
        condition = self.condition() if self._check("KEYWORD", "after") else None
        self._expect("SEMI", what="';'")
        return AllowStmt(start.line, subject, level, filters, condition)

    def deny_stmt(self) -> DenyStmt:
        start = self._expect("KEYWORD", "deny")
        subject = self.subject()
        self._expect("KEYWORD", "access")
        self._expect("KEYWORD", "to")
        filters = self.scope()
        self._expect("SEMI", what="';'")
        return DenyStmt(start.line, subject, filters)

    def release_stmt(self) -> ReleaseStmt:
        start = self._expect("KEYWORD", "release")
        self._expect("KEYWORD", "letters")
        self._expect("KEYWORD", "to")
        subject = self.subject()
        if not self._check("KEYWORD", "after"):
            raise PolicySyntaxError("release needs a condition: 'after <date>' or 'after death'",
                                    self._cur.line, self._cur.col)
        condition = self.condition()
        self._expect("SEMI", what="';'")
        return ReleaseStmt(start.line, subject, condition)

    def subject(self) -> str:
        if self._check("KEYWORD", "everyone"):
            return self._advance().value
        return self._expect("IDENT", what="a beneficiary, group or 'everyone'").value

    def level(self) -> str:
        tok = self._cur
        if tok.kind == "KEYWORD" and tok.value in LEVELS:
            return self._advance().value
        raise PolicySyntaxError(f"expected an access level (existence, summary or verbatim) but found '{tok.value}'",
                                tok.line, tok.col)

    def scope(self) -> tuple[FilterNode, ...]:
        self._expect("KEYWORD", "entries")
        filters = []
        while self._cur.kind == "KEYWORD" and self._cur.value in FILTER_KEYWORDS:
            filters.append(self.filter())
        return tuple(filters)

    def filter(self) -> FilterNode:
        kw = self._advance()
        if kw.value in ("about", "mentioning"):
            value = self._expect("STRING", what='a quoted text like "family"').value
        else:
            value = self._expect("DATE", what="a date (YYYY-MM-DD)").value
        return FilterNode(kw.line, kw.value, value)

    def condition(self) -> ConditionNode:
        kw = self._expect("KEYWORD", "after")
        if self._check("KEYWORD", "death"):
            self._advance()
            return ConditionNode(kw.line, "death")
        return ConditionNode(kw.line, "date", self._expect("DATE", what="a date or 'death'").value)


def parse(source: str) -> tuple[Program | None, list[PolicySyntaxError]]:
    """Parse *source*.  Returns ``(program, errors)``; program is None on lexical errors."""
    try:
        tokens = tokenize(source)
    except PolicySyntaxError as err:
        return None, [err]
    parser = Parser(tokens)
    program = parser.program()
    return program, parser.errors
