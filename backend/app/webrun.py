"""Browser runtime entry point (Pyodide).

The browser build runs this exact backend inside WebAssembly: the FastAPI app is
called directly through ASGI (no network server), SQLite lives in the browser's
memory and is saved per-browser by the page, and access decisions are made by
SWI-Prolog compiled to WebAssembly (see ``prolog/engine.py``).

Pyodide has no threads, so FastAPI's "run sync code in a thread pool" helper is
replaced by direct calls. Everything else is unchanged.
"""
from __future__ import annotations

import json
import os


def _patch_threadpool() -> None:
    import anyio.to_thread

    async def run_sync(func, *args, **kwargs):  # noqa: ARG001 - limiter etc. ignored
        return func(*args)

    anyio.to_thread.run_sync = run_sync

    async def run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)

    import fastapi.concurrency
    import fastapi.dependencies.utils
    import fastapi.routing
    import starlette.concurrency

    for mod in (starlette.concurrency, fastapi.concurrency, fastapi.routing, fastapi.dependencies.utils):
        if hasattr(mod, "run_in_threadpool"):
            mod.run_in_threadpool = run_in_threadpool


_app = None


def boot(db_path: str, jwt_secret: str) -> dict:
    """Initialise the app. Seeds the fictional demo vault when the database is new."""
    global _app
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["JWT_SECRET"] = jwt_secret
    os.environ.setdefault("LLM_PROVIDER", "offline")
    os.environ.setdefault("APP_TIMEZONE", "Asia/Manila")
    # The browser demo has no background server, so the executor's waiting period is shortened
    # from 14 days to 3 minutes so the whole flow can be tried in one sitting.
    os.environ.setdefault("DEATH_REPORT_WAIT_MINUTES", "3")
    # No email can be sent from the browser demo, so the verification code is shown on screen.
    os.environ.setdefault("DEV_SHOW_VERIFICATION_CODE", "true")
    _patch_threadpool()
    from sqlalchemy import select

    from .db import SessionLocal, init_db
    from .main import app
    from .models import User

    init_db()
    with SessionLocal() as db:
        empty = db.scalars(select(User).limit(1)).first() is None
    if empty:
        from .seed import seed

        seed()
    else:
        _backfill_demo_executor()
    _app = app
    return {"seeded": empty}


def _backfill_demo_executor() -> None:
    """Browser copies saved before executors existed: make Maria Elena's executor, as in a fresh seed."""
    from sqlalchemy import select

    from .db import SessionLocal
    from .models import User

    with SessionLocal() as db:
        elena = db.scalars(select(User).where(User.email == "elena@example.com")).first()
        maria = db.scalars(select(User).where(User.email == "maria@example.com")).first()
        if elena and maria and elena.executor_id is None and not elena.death_triggered_at:
            elena.executor_id = maria.id  # demo executor, as in a fresh seed
        db.commit()


async def handle(method: str, path: str, query: str, headers_json: str, body: str) -> str:
    """Run one HTTP request through the FastAPI app. Returns JSON {status, headers, body}."""
    headers = json.loads(headers_json or "{}")
    raw = (body or "").encode("utf-8")
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method.upper(),
        "scheme": "https", "path": path, "raw_path": path.encode(), "query_string": (query or "").encode(),
        "root_path": "", "server": ("alaala.local", 443), "client": ("browser", 0),
        "headers": [(k.lower().encode(), str(v).encode()) for k, v in headers.items()]
        + [(b"content-length", str(len(raw)).encode())],
    }
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    out = {"status": 500, "headers": {}, "body": b""}

    async def send(message):
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
            out["headers"] = {k.decode(): v.decode() for k, v in message.get("headers", [])}
        elif message["type"] == "http.response.body":
            out["body"] += message.get("body", b"")

    await _app(scope, receive, send)
    return json.dumps({"status": out["status"], "headers": out["headers"],
                       "body": out["body"].decode("utf-8", "replace")})
