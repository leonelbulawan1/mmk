"""Lexer for the MMK Legacy Policy Language."""
from __future__ import annotations

from dataclasses import dataclass

KEYWORDS = frozenset({
    "group", "allow", "deny", "release", "letters", "to", "access", "entries", "everyone",
    "existence", "summary", "verbatim", "about", "mentioning", "from", "until", "after", "death",
})


@dataclass(frozen=True)
class Token:
    kind: str  # KEYWORD | IDENT | STRING | DATE | EQUALS | COMMA | SEMI | EOF
    value: str
    line: int
    col: int

    def __str__(self) -> str:
        return f"{self.kind}({self.value!r}) at {self.line}:{self.col}"


class PolicySyntaxError(Exception):
    def __init__(self, message: str, line: int, col: int):
        super().__init__(f"Line {line}, column {col}: {message}")
        self.message, self.line, self.col = message, line, col

    def to_dict(self) -> dict:
        return {"message": self.message, "line": self.line, "col": self.col}


_PUNCT = {"=": "EQUALS", ",": "COMMA", ";": "SEMI"}


def tokenize(source: str) -> list[Token]:
    tokens: list[Token] = []
    i, line, col, n = 0, 1, 1, len(source)

    def advance(k: int = 1) -> None:
        nonlocal i, line, col
        for _ in range(k):
            if source[i] == "\n":
                line, col = line + 1, 1
            else:
                col += 1
            i += 1

    while i < n:
        ch = source[i]
        if ch in " \t\r\n":
            advance()
        elif ch == "#":
            while i < n and source[i] != "\n":
                advance()
        elif ch in _PUNCT:
            tokens.append(Token(_PUNCT[ch], ch, line, col))
            advance()
        elif ch == '"':
            start_line, start_col = line, col
            advance()
            buf = []
            while i < n and source[i] not in '"\n':
                buf.append(source[i])
                advance()
            if i >= n or source[i] != '"':
                raise PolicySyntaxError("unterminated string", start_line, start_col)
            advance()
            value = "".join(buf).strip()
            if not value:
                raise PolicySyntaxError("empty string", start_line, start_col)
            tokens.append(Token("STRING", value, start_line, start_col))
        elif ch.isdigit():
            start_line, start_col, j = line, col, i
            while j < n and (source[j].isdigit() or source[j] == "-"):
                j += 1
            text = source[i:j]
            if len(text) != 10 or text[4] != "-" or text[7] != "-" or not (text[:4] + text[5:7] + text[8:]).isdigit():
                raise PolicySyntaxError(f"invalid date '{text}' (expected YYYY-MM-DD)", start_line, start_col)
            tokens.append(Token("DATE", text, start_line, start_col))
            advance(j - i)
        elif ch.isalpha():
            start_line, start_col, j = line, col, i
            while j < n and (source[j].isalnum() or source[j] == "_"):
                j += 1
            word = source[i:j]
            if word.lower() in KEYWORDS:
                tokens.append(Token("KEYWORD", word.lower(), start_line, start_col))
            else:
                if word != word.lower():
                    raise PolicySyntaxError(f"identifier '{word}' must be lowercase", start_line, start_col)
                tokens.append(Token("IDENT", word, start_line, start_col))
            advance(j - i)
        else:
            raise PolicySyntaxError(f"unexpected character '{ch}'", line, col)
    tokens.append(Token("EOF", "", line, col))
    return tokens
