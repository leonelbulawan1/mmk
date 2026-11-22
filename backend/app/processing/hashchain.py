"""Hash chaining (pure functions).

Each vault record stores ``prev_hash`` and ``hash`` where::

    hash = SHA-256( prev_hash || canonical_json(payload) )

The first record of a chain links to :data:`GENESIS`.  Any modification of an
earlier record's payload, deletion, insertion or re-ordering changes a hash and is
reported by :func:`verify_chain`.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

GENESIS = "0" * 64


def canonical_json(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def link_hash(prev_hash: str, payload: Mapping[str, Any]) -> str:
    return hashlib.sha256((prev_hash + canonical_json(payload)).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChainRecord:
    seq: int
    ref: str  # human readable reference, e.g. "entry:12" / "revision:3"
    payload: Mapping[str, Any]
    prev_hash: str
    hash: str


@dataclass(frozen=True)
class ChainProblem:
    seq: int
    ref: str
    problem: str


@dataclass(frozen=True)
class ChainReport:
    ok: bool
    length: int
    head: str
    problems: tuple[ChainProblem, ...]

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "length": self.length,
            "head": self.head,
            "problems": [p.__dict__ for p in self.problems],
        }


def verify_chain(records: Iterable[ChainRecord]) -> ChainReport:
    """Recompute every link.  Pure: no I/O, no mutation."""
    ordered = tuple(sorted(records, key=lambda r: r.seq))
    problems: list[ChainProblem] = []
    expected_prev = GENESIS
    expected_seq = 1
    for rec in ordered:
        if rec.seq != expected_seq:
            problems.append(ChainProblem(rec.seq, rec.ref, f"sequence gap: expected {expected_seq}"))
        if rec.prev_hash != expected_prev:
            problems.append(ChainProblem(rec.seq, rec.ref, "prev_hash does not match previous record"))
        recomputed = link_hash(rec.prev_hash, rec.payload)
        if recomputed != rec.hash:
            problems.append(ChainProblem(rec.seq, rec.ref, "content hash mismatch (record was modified)"))
        expected_prev = rec.hash
        expected_seq = rec.seq + 1
    head = ordered[-1].hash if ordered else GENESIS
    return ChainReport(ok=not problems, length=len(ordered), head=head, problems=tuple(problems))
