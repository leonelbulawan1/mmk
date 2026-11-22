"""MMK API entry point."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .errors import AccessDenied, PolicySyntaxError, TamperDetected
from .prolog.engine import swipl_available
from .routers import assistant, auth, beneficiaries, entries, executor, policy, settings as settings_router, vault


async def _due_reports_loop() -> None:
    """Activate executor reports whose waiting period has ended, even if nobody is signed in."""
    from .db import SessionLocal
    from .services import death, notify

    while True:
        with suppress(Exception), SessionLocal() as db:
            death.process_due(db)
        with suppress(Exception), SessionLocal() as db:
            notify.process_outbox(db)  # retry emails whose next attempt is due
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    task = asyncio.create_task(_due_reports_loop())
    yield
    task.cancel()


app = FastAPI(title="MMK API", version="1.0.0", lifespan=lifespan)


# Typed failures -> safe responses (see app/errors.py)
@app.exception_handler(AccessDenied)
async def _access_denied(request: Request, exc: AccessDenied):
    return JSONResponse(status_code=404, content={"detail": "Not found"})  # same as missing: confirm nothing


@app.exception_handler(TamperDetected)
async def _tamper_detected(request: Request, exc: TamperDetected):
    return JSONResponse(status_code=503, content={
        "detail": "This diary failed its integrity check, so nothing can be shared until the problem is resolved."})


@app.exception_handler(PolicySyntaxError)
async def _policy_syntax(request: Request, exc: PolicySyntaxError):
    return JSONResponse(status_code=422, content={"detail": f"The policy has a syntax error: {exc}"})
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")  # private diary data is never cached
    return response


for r in (auth.router, entries.router, beneficiaries.router, policy.router, assistant.router, vault.router,
          settings_router.router, executor.router):
    app.include_router(r)


@app.get("/api/ping")
def ping():
    """Cheap liveness check for the host: does not touch the database."""
    return {"status": "ok"}


@app.get("/api/health")
def health():
    """Liveness check. Also activates any executor report whose waiting period has ended, so a
    scheduler pinging this URL (e.g. Cloud Scheduler every 10 minutes) keeps reports on time even
    when Cloud Run has scaled to zero."""
    from .db import SessionLocal
    from .services import death

    activated = 0
    try:
        with SessionLocal() as db:
            activated = death.process_due(db)
        with SessionLocal() as db:
            from .services import notify
            notify.process_outbox(db)
    except Exception:  # never fail the health check because of this
        pass
    return {"status": "ok", "prolog": swipl_available(), "llm_provider": settings.llm_provider,
            "reports_activated": activated}
