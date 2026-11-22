"""Translation of compiled policies to Prolog, plus JSON (de)serialisation of rules.

Rules are stored as structured JSON next to their source, so the exact policy
in force is preserved even if beneficiaries are later deactivated.
"""
from __future__ import annotations

import json
from datetime import date

from ..domain.protocol import (AfterDate, AfterDeath, Always, Condition, Denial, Filter, FromFilter, Grant, Group,
                               LetterRelease, MentionFilter, Protocol, Rule, TopicFilter, UntilFilter)


def translate(protocol: Protocol) -> str:
    """Return the policy as a commented Prolog program."""
    lines = [f"% MMK policy v{protocol.version} for owner {protocol.owner_id} (generated - do not edit)"]
    for i, rule in enumerate(protocol.rules, start=1):
        lines.append(f"% [{i}] line {rule.line}: {rule.describe()}")
        lines.extend(rule.to_prolog(i))
    if protocol.frozen:
        lines.append("policy_frozen.")
    return "\n".join(lines) + "\n"


# ---- JSON round-trip -------------------------------------------------------------------
def _filter_to(f: Filter) -> dict:
    if isinstance(f, TopicFilter):
        return {"about": f.topic}
    if isinstance(f, MentionFilter):
        return {"mentioning": f.name}
    if isinstance(f, FromFilter):
        return {"from": f.since.isoformat()}
    return {"until": f.until.isoformat()}  # UntilFilter


def _filter_from(d: dict) -> Filter:
    (k, v), = d.items()
    return {"about": lambda: TopicFilter(v), "mentioning": lambda: MentionFilter(v),
            "from": lambda: FromFilter(date.fromisoformat(v)), "until": lambda: UntilFilter(date.fromisoformat(v))}[k]()


def _cond_to(c: Condition) -> dict:
    if isinstance(c, AfterDate):
        return {"after": c.when.isoformat()}
    if isinstance(c, AfterDeath):
        return {"after": "death"}
    return {"always": True}


def _cond_from(d: dict) -> Condition:
    if "after" in d:
        return AfterDeath() if d["after"] == "death" else AfterDate(date.fromisoformat(d["after"]))
    return Always()


def rules_to_json(rules: tuple[Rule, ...]) -> str:
    out = []
    for r in rules:
        if isinstance(r, Group):
            out.append({"t": "group", "line": r.line, "name": r.name, "members": list(r.members)})
        elif isinstance(r, Grant):
            out.append({"t": "grant", "line": r.line, "who": r.who, "level": r.level,
                        "filters": [_filter_to(f) for f in r.filters], "cond": _cond_to(r.condition)})
        elif isinstance(r, Denial):
            out.append({"t": "deny", "line": r.line, "who": r.who, "filters": [_filter_to(f) for f in r.filters]})
        elif isinstance(r, LetterRelease):
            out.append({"t": "letters", "line": r.line, "who": r.who, "cond": _cond_to(r.condition)})
    return json.dumps(out)


def rules_from_json(text: str) -> tuple[Rule, ...]:
    rules: list[Rule] = []
    for d in json.loads(text or "[]"):
        t = d["t"]
        if t == "group":
            rules.append(Group(d["line"], d["name"], tuple(d["members"])))
        elif t == "grant":
            rules.append(Grant(d["line"], d["who"], d["level"], tuple(_filter_from(f) for f in d["filters"]),
                               _cond_from(d["cond"])))
        elif t == "deny":
            rules.append(Denial(d["line"], d["who"], tuple(_filter_from(f) for f in d["filters"])))
        elif t == "letters":
            rules.append(LetterRelease(d["line"], d["who"], _cond_from(d["cond"])))
    return tuple(rules)
