"""Database engine, sessions and append-only enforcement.

Append-only tables are protected twice:

1. ORM level - SQLAlchemy ``before_update`` / ``before_delete`` listeners raise.
2. Database level - triggers (SQLite / PostgreSQL) abort UPDATE and DELETE.

Hash-chain verification is the third line of defence: it detects changes made
by anyone who bypasses both layers (e.g. editing the database file directly).
"""
from __future__ import annotations

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

APPEND_ONLY_TABLES = ("entries", "revisions", "policy_versions", "audit_log")


class Base(DeclarativeBase):
    pass


def normalize_database_url(url: str) -> str:
    """Accept connection strings exactly as hosts give them (postgres://, postgresql://) and use psycopg 3."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str):
    url = normalize_database_url(url)
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # Free serverless databases (e.g. Neon) suspend when idle and drop open connections:
        # test each pooled connection before use and recycle them every few minutes.
        kwargs.update(pool_pre_ping=True, pool_recycle=300)
    engine = create_engine(url, future=True, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _fk(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return engine


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def install_append_only_triggers(bind) -> None:
    dialect = bind.dialect.name
    with bind.begin() as conn:
        for table in APPEND_ONLY_TABLES:
            if dialect == "sqlite":
                for op in ("UPDATE", "DELETE"):
                    conn.execute(text(
                        f"CREATE TRIGGER IF NOT EXISTS {table}_no_{op.lower()} BEFORE {op} ON {table} "
                        f"BEGIN SELECT RAISE(ABORT, '{table} is append-only'); END;"))
            elif dialect == "postgresql":
                conn.execute(text(
                    "CREATE OR REPLACE FUNCTION alaala_append_only() RETURNS trigger AS $$ "
                    "BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;"))
                conn.execute(text(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}"))
                conn.execute(text(
                    f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
                    f"FOR EACH ROW EXECUTE FUNCTION alaala_append_only()"))


# Columns added after the first release: (table, column, SQL type). Added in place on startup so
# existing databases (including browser copies saved in IndexedDB) keep working.
# (table, column, SQL type, optional SQL run once right after adding the column)
LATER_COLUMNS = (
    ("users", "recovery_code_hash", "VARCHAR(128)", None),
    ("users", "executor_id", "INTEGER", None),
    # Accounts that existed before email verification are treated as verified, so nobody is locked out.
    ("users", "email_verified_at", "VARCHAR(40)", "UPDATE users SET email_verified_at = created_at"),
    ("users", "verify_code_hash", "VARCHAR(128)", None),
    ("users", "verify_expires_at", "VARCHAR(40)", None),
    ("users", "verify_sent_at", "VARCHAR(40)", None),
    ("users", "verify_attempts", "INTEGER DEFAULT 0", None),
    ("users", "reset_code_hash", "VARCHAR(128)", None),
    ("users", "reset_expires_at", "VARCHAR(40)", None),
    ("users", "reset_sent_at", "VARCHAR(40)", None),
    ("users", "reset_attempts", "INTEGER DEFAULT 0", None),
    ("users", "token_version", "INTEGER DEFAULT 0", None),
    ("email_notices", "entry_id", "INTEGER", None),
    ("email_notices", "provider_id", "VARCHAR(200)", None),
    ("entries", "deliver_while_alive", "BOOLEAN DEFAULT FALSE", None),
    ("email_notices", "next_attempt_at", "VARCHAR(40)", None),
    ("email_notices", "idempotency_key", "VARCHAR(120)", None),
    ("entries", "release_days_after_death", "INTEGER", None),
    ("users", "email_letters", "BOOLEAN DEFAULT TRUE", None),
    ("users", "allow_ai_answers", "BOOLEAN DEFAULT TRUE", None),
    ("death_reports", "reviewer_id", "INTEGER", None),
    ("death_reports", "reviewed_at", "VARCHAR(40)", None),
    ("death_reports", "decision_note", "TEXT", None),
    ("death_reports", "disputed_by", "INTEGER", None),
    ("death_reports", "dispute_reason", "TEXT", None),
)


def _add_missing_columns(bind) -> None:
    from sqlalchemy import inspect

    insp = inspect(bind)
    with bind.begin() as conn:
        for table, column, sql_type, backfill in LATER_COLUMNS:
            if table in insp.get_table_names() and column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))
                if backfill and "created_at" in {c["name"] for c in insp.get_columns(table)}:
                    conn.execute(text(backfill))
        if "email_notices" in insp.get_table_names():  # older databases: add the outbox indexes
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_email_notices_idempotency "
                              "ON email_notices (idempotency_key)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_email_notices_next_attempt ON email_notices (next_attempt_at)"))


def init_db(bind=None) -> None:
    from . import models  # noqa: F401  (register tables)

    bind = bind or engine
    Base.metadata.create_all(bind)
    _add_missing_columns(bind)
    install_append_only_triggers(bind)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
