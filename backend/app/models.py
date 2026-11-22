"""SQLAlchemy ORM models (persistence layer).

Timestamps that participate in hashes are stored as ISO-8601 strings so that they
round-trip byte-for-byte, regardless of the database's timezone handling.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("owner_id", "handle", name="uq_beneficiary_handle"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(20))  # owner | beneficiary
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    handle: Mapped[str | None] = mapped_column(String(40), nullable=True)
    relationship: Mapped[str] = mapped_column(String(80), default="")
    invite_code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recovery_code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    executor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # owner's chosen executor (a beneficiary)
    # Email verification (owners). Beneficiaries' emails are confirmed by the invite they activate.
    email_verified_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verify_code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verify_expires_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verify_sent_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verify_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Password reset by emailed code.
    reset_code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reset_expires_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reset_sent_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reset_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Bumped on password reset/change: every session token issued before it stops working.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    death_triggered_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    default_writing_mode: Mapped[str] = mapped_column(String(20), default="verbatim")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class EntryRow(Base):
    __tablename__ = "entries"
    __table_args__ = (UniqueConstraint("owner_id", "seq", name="uq_entry_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))  # text | letter
    title: Mapped[str] = mapped_column(String(200), default="")
    original_text: Mapped[str] = mapped_column(Text)
    entry_date: Mapped[str] = mapped_column(String(10), index=True)
    created_at: Mapped[str] = mapped_column(String(40))
    writing_mode: Mapped[str] = mapped_column(String(20))
    names_json: Mapped[str] = mapped_column(Text, default="[]")
    topics_json: Mapped[str] = mapped_column(Text, default="[]")
    summary: Mapped[str] = mapped_column(Text, default="")
    recipient_handle: Mapped[str | None] = mapped_column(String(40), nullable=True)
    release_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    release_on_death: Mapped[bool] = mapped_column(Boolean, default=False)
    deliver_while_alive: Mapped[bool] = mapped_column(Boolean, default=False)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class RevisionRow(Base):
    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("owner_id", "seq", name="uq_revision_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id"), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[str] = mapped_column(String(40))
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class PolicyVersion(Base):
    __tablename__ = "policy_versions"
    __table_args__ = (UniqueConstraint("owner_id", "version", name="uq_policy_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(Text)
    rules_json: Mapped[str] = mapped_column(Text)
    prolog_facts: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class AuditRow(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_role: Mapped[str] = mapped_column(String(20), default="")
    action: Mapped[str] = mapped_column(String(60), index=True)
    detail_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class EmailNotice(Base):
    """Outgoing email to a beneficiary (outbox). Bodies never contain diary content."""

    __tablename__ = "email_notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    to_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(30), default="death_notice")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # see services/notify.py (outbox statuses)
    error: Mapped[str] = mapped_column(Text, default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    sent_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entry_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # the letter a letter_released notice is about
    provider_id: Mapped[str | None] = mapped_column(String(200), nullable=True)  # the email service's message id
    next_attempt_at: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # when to retry
    # Same key = same message: a letter is emailed to its recipient at most once, even if two sweeps overlap.
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)


class DeathReport(Base):
    """An executor's report that the owner has passed away.

    It activates the death trigger only after a waiting period, during which the owner can
    cancel it by signing in ("I'm still here").
    """

    __tablename__ = "death_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    reported_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reported_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    activates_at: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|cancelled|withdrawn|activated
    closed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class QAMessage(Base):
    __tablename__ = "qa_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    asker_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    as_handle: Mapped[str] = mapped_column(String(40))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    citations_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


# ---- ORM-level append-only guards -------------------------------------------------------
def _forbid(kind: str):
    def _listener(mapper, connection, target):
        raise PermissionError(f"{target.__tablename__} rows are append-only ({kind} refused)")
    return _listener


for _model in (EntryRow, RevisionRow, PolicyVersion, AuditRow):
    event.listen(_model, "before_update", _forbid("update"))
    event.listen(_model, "before_delete", _forbid("delete"))
