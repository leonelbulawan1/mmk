"""Limits on wrong sign-in and activation attempts, so a password or invite code cannot be guessed.

Counts are kept in memory for a sliding window. MMK runs as one server process, so this is enough here;
a restart clears the counts (it never locks anyone out for longer than the window).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

WINDOW_SECONDS = 15 * 60
PER_ACCOUNT = 5    # wrong attempts for one email within the window
PER_ADDRESS = 20   # wrong attempts from one network address within the window

_fails: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request | None) -> str:
    if request is None:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for", "")  # set by Render's proxy
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or "unknown"


def _recent(key: str, now: float) -> deque:
    q = _fails[key]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    return q


def check(kind: str, email: str, ip: str) -> None:
    """Raise 429 if this email or address has failed too often recently."""
    now = time.monotonic()
    acct, addr = _recent(f"{kind}:e:{email.lower()}", now), _recent(f"{kind}:ip:{ip}", now)
    if len(acct) >= PER_ACCOUNT or len(addr) >= PER_ADDRESS:
        oldest = min(q[0] for q in (acct, addr) if q)
        minutes = max(1, int((WINDOW_SECONDS - (now - oldest)) // 60) + 1)
        raise HTTPException(429, f"Too many attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}, "
                                 "or reset your password.")


def failed(kind: str, email: str, ip: str) -> None:
    now = time.monotonic()
    _fails[f"{kind}:e:{email.lower()}"].append(now)
    _fails[f"{kind}:ip:{ip}"].append(now)


def succeeded(kind: str, email: str) -> None:
    _fails.pop(f"{kind}:e:{email.lower()}", None)


def reset_all() -> None:  # tests
    _fails.clear()
