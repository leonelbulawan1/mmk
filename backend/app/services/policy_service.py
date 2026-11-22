"""Policy versions (append-only, hash-chained) and the Prolog access engine."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain import PolicyFrozenError, Protocol
from ..models import PolicyVersion, User
from ..policy_lang.interpreter import CompileResult, compile_policy
from ..policy_lang.to_prolog import rules_from_json, rules_to_json, translate
from ..processing.hashchain import GENESIS, link_hash
from ..prolog.engine import AccessEngine, Decision
from . import audit
from .vault_service import beneficiary_rows, load_vault

DEFAULT_POLICY = """# Your legacy policy.
# Nothing is shared while you are alive. After your passing, only what you allow here
# is shared (deny by default).
# Example:
#   allow maria summary access to entries about "family";
"""


def latest_version(db: Session, owner: User) -> PolicyVersion | None:
    return db.scalars(select(PolicyVersion).where(PolicyVersion.owner_id == owner.id)
                      .order_by(PolicyVersion.version.desc()).limit(1)).first()


def current_protocol(db: Session, owner: User) -> Protocol:
    row = latest_version(db, owner)
    frozen = bool(owner.death_triggered_at)
    if row is None:
        return Protocol(owner.id, (), DEFAULT_POLICY, 0, frozen)
    return Protocol(owner.id, rules_from_json(row.rules_json), row.source, row.version, frozen)


def handles(db: Session, owner: User) -> set[str]:
    return {b.handle for b in beneficiary_rows(db, owner)}


def engine_for(db: Session, owner: User, assume_death: bool = False) -> AccessEngine:
    vault = load_vault(db, owner)
    return AccessEngine(vault.entries, current_protocol(db, owner), sorted(handles(db, owner)),
                        bool(owner.death_triggered_at), assume_death, death_date=death_date(owner))


def death_date(owner: User):
    """The date of the death trigger in the app's time zone; for the owner's own previews, today."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from ..config import settings, today

    if not owner.death_triggered_at:
        return today()
    try:
        return datetime.fromisoformat(owner.death_triggered_at).astimezone(ZoneInfo(settings.timezone)).date()
    except Exception:
        return datetime.fromisoformat(owner.death_triggered_at).date()


def compile_for(db: Session, owner: User, source: str) -> CompileResult:
    return compile_policy(source, handles(db, owner), owner.id)


def save_policy(db: Session, owner: User, source: str) -> tuple[CompileResult, PolicyVersion | None]:
    protocol = current_protocol(db, owner)
    # Two independent checks: the domain object and the Prolog rule can_modify_policy.
    if protocol.frozen or not engine_for(db, owner).can_modify_policy():
        raise PolicyFrozenError("The policy is frozen after the death trigger")
    result = compile_for(db, owner, source)
    if not result.ok:
        return result, None
    nxt = protocol.replace(result.protocol.rules, source)
    prev = latest_version(db, owner)
    prev_hash = prev.hash if prev else GENESIS
    rules_json = rules_to_json(nxt.rules)
    facts = translate(nxt)
    payload = {"owner_id": owner.id, "version": nxt.version, "source": source, "rules_json": rules_json}
    row = PolicyVersion(owner_id=owner.id, version=nxt.version, source=source, rules_json=rules_json,
                        prolog_facts=facts, prev_hash=prev_hash, hash=link_hash(prev_hash, payload))
    db.add(row)
    db.flush()
    audit.record(db, owner.id, owner, "policy.save", {"version": nxt.version, "rules": len(nxt.rules),
                                                      "hash": row.hash}, commit=False)
    db.commit()
    return result, row


def decisions_for(db: Session, owner: User, handle: str, today: date, assume_death: bool = False) -> dict[int, Decision]:
    return engine_for(db, owner, assume_death).decide_all(handle, today)


def letter_release_rules(protocol: Protocol, handle: str) -> list:
    """The policy's `release letters to ...` rules that reach this beneficiary
    (directly, through `everyone`, or through a group). Mirrors applies/2 in access_rules.pl."""
    from ..domain.protocol import Group, LetterRelease
    groups = {r.name for r in protocol.rules if isinstance(r, Group) and handle in r.members}
    return [r for r in protocol.rules
            if isinstance(r, LetterRelease) and (r.who in ("everyone", handle) or r.who in groups)]


def letter_releases_for(protocol: Protocol, handle: str) -> list[str]:
    """Readable text of the release rules that reach this beneficiary."""
    return [r.describe() for r in letter_release_rules(protocol, handle)]


def add_letter_release(db: Session, owner: User, handle: str):
    """Append `release letters to <handle> after death;` to the policy and save a new version."""
    source = current_protocol(db, owner).source.rstrip()
    line = f"release letters to {handle} after death;"
    return save_policy(db, owner, f"{source}\n\n# Added from the Write page so this letter can be delivered\n{line}\n")
