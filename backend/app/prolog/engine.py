"""Python -> SWI-Prolog bridge.

Each query writes a self-contained fact file (owner's entries metadata, the
compiled policy, beneficiaries, death/frozen flags) and runs ``swipl`` on it
together with ``access_rules.pl``.  Only *metadata* is sent to Prolog (ids,
dates, topics, names) - never entry text.

The bridge fails closed: if Prolog is missing, times out or errors, a
:class:`PrologError` is raised and callers treat it as "deny everything".
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

from ..config import settings
from ..domain.entries import Entry, LetterEntry
from ..domain.protocol import Protocol, pl_atom, pl_date

RULES_FILE = Path(__file__).with_name("access_rules.pl")


class PrologError(RuntimeError):
    pass


@dataclass(frozen=True)
class Decision:
    entry_id: int
    level: str
    reason: str


IN_BROWSER = sys.platform == "emscripten"  # running inside Pyodide (the browser build)


def swipl_available() -> bool:
    if IN_BROWSER:
        try:
            import js  # type: ignore

            return bool(getattr(js, "alaalaProlog", None))
        except ImportError:
            return False
    return shutil.which(settings.swipl_path) is not None


def _run_wasm(facts: list[str], goal: str) -> str:
    """Browser build: the same access_rules.pl runs in SWI-Prolog compiled to WebAssembly."""
    import js  # type: ignore

    header = ":- style_check(-discontiguous).\n"
    out = js.alaalaProlog(header + "\n".join(facts) + "\n", goal)
    out = "" if out is None else str(out)
    if out.startswith("\u0000ERR:"):
        raise PrologError(f"Prolog failed: {out[5:][:500]}")
    return out


def build_facts(entries: Iterable[Entry], protocol: Protocol, beneficiaries: Iterable[str],
                death_triggered: bool) -> list[str]:
    facts: list[str] = []
    for handle in beneficiaries:
        facts.append(f"beneficiary({pl_atom(handle)}).")
    for e in entries:
        facts.append(f"entry({int(e.id)}, {pl_date(e.entry_date)}, {e.kind}).")
        for t in sorted(e.extraction.topics):
            facts.append(f"entry_topic({int(e.id)}, {pl_atom(t.lower())}).")
        for n in sorted(e.extraction.names):
            facts.append(f"entry_name({int(e.id)}, {pl_atom(n.lower())}).")
        if isinstance(e, LetterEntry):
            facts.append(f"letter_to({int(e.id)}, {pl_atom(e.recipient_handle)}).")
            if e.release_on is not None:
                facts.append(f"letter_cond({int(e.id)}, date({pl_date(e.release_on)})).")
            if e.release_on_death:
                facts.append(f"letter_cond({int(e.id)}, death).")
            if e.deliver_while_alive:
                facts.append(f"deliver_while_alive({int(e.id)}).")
    facts.extend(protocol.to_prolog_facts())
    if death_triggered:
        facts.append("death_triggered.")
    return facts


def _run(facts: list[str], goal: str) -> str:
    if IN_BROWSER:
        if not swipl_available():
            raise PrologError("SWI-Prolog (WebAssembly) is not loaded")
        return _run_wasm(facts, goal)
    if not swipl_available():
        raise PrologError("SWI-Prolog (swipl) is not installed or not on PATH")
    with tempfile.TemporaryDirectory(prefix="alaala_pl_") as tmp:
        facts_file = Path(tmp) / "facts.pl"
        # Declarations are in access_rules.pl; silence discontiguous warnings for generated facts.
        header = ":- style_check(-discontiguous).\n"
        facts_file.write_text(header + "\n".join(facts) + "\n", encoding="utf-8")
        cmd = [settings.swipl_path, "-q", "--no-packs", "-f", "none",
               "-g", f"consult({pl_atom(str(RULES_FILE))}), consult({pl_atom(str(facts_file))}), {goal}",
               "-t", "halt"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=settings.prolog_timeout_s,
                                  env={**os.environ, "LANG": "C.UTF-8"})
        except subprocess.TimeoutExpired as exc:
            raise PrologError("Prolog query timed out") from exc
        if proc.returncode != 0 or "error" in proc.stderr.lower():
            raise PrologError(f"Prolog failed: {proc.stderr.strip()[:500]}")
        return proc.stdout


_LINE = re.compile(r"^(\d+)\t(none|existence|summary|verbatim)\t(.+)$")
_MLINE = re.compile(r"^([^\t]+)\t(\d+)\t(none|existence|summary|verbatim)\t(.+)$")


class AccessEngine:
    """Facade used by the service layer."""

    def __init__(self, entries: Iterable[Entry], protocol: Protocol, beneficiaries: Iterable[str],
                 death_triggered: bool, assume_death: bool = False):
        """``assume_death`` evaluates "as if after the owner's passing" - only for the owner's own
        previews (access matrix, assistant preview), never for a beneficiary's real access."""
        self._entries = tuple(entries)
        self._facts = build_facts(self._entries, protocol, tuple(beneficiaries), death_triggered or assume_death)
        self._real_facts = (self._facts if not assume_death or death_triggered
                            else build_facts(self._entries, protocol, tuple(beneficiaries), death_triggered))

    @property
    def facts(self) -> tuple[str, ...]:
        return tuple(self._facts)

    def decide_all(self, handle: str, today: date) -> dict[int, Decision]:
        out = _run(self._facts, f"decide_all({pl_atom(handle)}, {pl_date(today)})")
        decisions: dict[int, Decision] = {}
        for line in out.splitlines():
            m = _LINE.match(line.strip())
            if m:
                decisions[int(m.group(1))] = Decision(int(m.group(1)), m.group(2), m.group(3))
        # Fail closed: an entry Prolog did not report on gets no access.
        for e in self._entries:
            decisions.setdefault(int(e.id), Decision(int(e.id), "none", "default_deny"))
        return decisions

    def matrix(self, today: date) -> dict[str, dict[int, Decision]]:
        out = _run(self._facts, f"decide_matrix({pl_date(today)})")
        result: dict[str, dict[int, Decision]] = {}
        for line in out.splitlines():
            m = _MLINE.match(line.strip())
            if m:
                result.setdefault(m.group(1), {})[int(m.group(2))] = Decision(int(m.group(2)), m.group(3), m.group(4))
        return result

    def can_modify_policy(self) -> bool:
        return _run(self._real_facts, "report_modifiable").strip() == "yes"
