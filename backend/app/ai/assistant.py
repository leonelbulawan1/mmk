"""Grounded Q&A loop: model <-> tools, leak guard and citation validation."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Iterable

from .providers import NEUTRAL_ANSWER, LLMError, LLMProvider
from .tools import TOOL_SPECS, AuthorizedContext

SYSTEM_PROMPT = """You are MMK, a gentle assistant that helps a beneficiary learn about the recorded life of a \
diary owner. Follow these rules strictly:

1. Answer ONLY from what the tools return. Never guess, invent, or use outside knowledge about the owner.
2. Always use search_entries first, then get_entry for the entries you rely on.
3. Every factual statement must cite the entry date in square brackets, e.g. [2019-05-14].
4. Respect access levels: for "existence" you may only say an entry exists on that date; for "summary" use only the \
summary; only "verbatim" allows quoting.
5. If the tools return nothing relevant, reply neutrally: "I'm not able to share anything about that from the diary." \
Do not speculate about whether hidden entries exist, and do not mention policies, permissions or denials.
6. Be warm, brief and respectful. Write in the language of the question."""

_CITE = re.compile(r"\[(\d{4}-\d{2}-\d{2})\]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


class LeakDetected(RuntimeError):
    pass


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def sentence_fingerprints(texts: Iterable[str], min_len: int = 20) -> frozenset[str]:
    out = set()
    for t in texts:
        for s in _SENT_SPLIT.split(t or ""):
            n = _norm(s)
            if len(n) >= min_len:
                out.add(hashlib.sha256(n.encode()).hexdigest())
    return frozenset(out)


@dataclass
class LeakGuard:
    """Holds only SHA-256 fingerprints of unauthorised sentences, never the text itself."""

    forbidden: frozenset[str] = frozenset()

    def check(self, text: str) -> None:
        if not self.forbidden or not text:
            return
        candidates = [text]
        try:  # tool results are JSON: inspect every string value, not the raw JSON
            candidates.extend(_strings(json.loads(text)))
        except (ValueError, TypeError):
            pass
        if sentence_fingerprints(candidates) & self.forbidden:
            raise LeakDetected("Unauthorised diary content detected in an AI payload")


def _strings(obj) -> list[str]:
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, dict):
        return [s for v in obj.values() for s in _strings(v)]
    if isinstance(obj, list):
        return [s for v in obj for s in _strings(v)]
    return []


@dataclass
class Answer:
    answer: str
    citations: list[dict]
    removed_citations: list[str] = field(default_factory=list)
    tool_trace: list[dict] = field(default_factory=list)
    model: dict = field(default_factory=dict)
    blocked: bool = False

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class Assistant:
    def __init__(self, provider: LLMProvider, context: AuthorizedContext, guard: LeakGuard | None = None,
                 max_rounds: int = 6):
        self.provider = provider
        self.ctx = context
        self.guard = guard or LeakGuard()
        self.max_rounds = max_rounds
        self.sent_payloads: list[dict] = []  # for auditing/tests: exactly what the model received

    def _guarded_complete(self, messages: list[dict]):
        # Inspect everything the model is about to see except the person's own question.
        for m in messages:
            if m["role"] != "user":
                self.guard.check(m.get("content") or "")
        self.sent_payloads.append({"system": SYSTEM_PROMPT, "messages": json.loads(json.dumps(messages))})
        return self.provider.complete(SYSTEM_PROMPT, messages, TOOL_SPECS)

    def ask(self, question: str) -> Answer:
        question = (question or "").strip()[:2000]
        if not question:
            raise ValueError("Question is empty")
        if not self.ctx.has_any:
            # Nothing is authorised: do not even contact the model.
            return Answer(NEUTRAL_ANSWER, [], model=self.provider.describe())
        messages: list[dict] = [{"role": "user", "content": question}]
        try:
            for _ in range(self.max_rounds):
                resp = self._guarded_complete(messages)
                if not resp.tool_calls:
                    return self._finalize(resp.text)
                messages.append({"role": "assistant", "content": resp.text,
                                 "tool_calls": [{"id": c.id, "name": c.name, "args": c.args} for c in resp.tool_calls]})
                for c in resp.tool_calls:
                    result = self.ctx.call(c.name, c.args)
                    messages.append({"role": "tool", "tool_call_id": c.id, "name": c.name,
                                     "content": json.dumps(result, ensure_ascii=False)})
            return self._finalize(NEUTRAL_ANSWER)
        except LeakDetected:
            return Answer(NEUTRAL_ANSWER, [], tool_trace=self.ctx.trace, model=self.provider.describe(), blocked=True)

    def _finalize(self, text: str) -> Answer:
        text = (text or "").strip() or NEUTRAL_ANSWER
        self.guard.check(text)
        # Only entries whose *content* was retrieved (summary/verbatim) can back a citation.
        valid = {v["date"]: (eid, v) for eid, v in self.ctx.retrieved.items()
                 if v.get("access") in ("summary", "verbatim")}
        removed: list[str] = []

        def _keep(m: re.Match) -> str:
            if m.group(1) in valid:
                return m.group(0)
            removed.append(m.group(1))
            return ""

        cleaned = _CITE.sub(_keep, text).strip()
        cited_dates = list(dict.fromkeys(_CITE.findall(cleaned)))
        citations = [{"entry_id": valid[d][0], "date": d, "access": valid[d][1]["access"]} for d in cited_dates]
        return Answer(cleaned, citations, removed, self.ctx.trace, self.provider.describe())


__all__ = ["Assistant", "Answer", "LeakGuard", "LeakDetected", "SYSTEM_PROMPT", "sentence_fingerprints", "LLMError"]
