"""Checks an email address before MMK sends an invitation to it.

What can be known before sending:
* the format (already checked by pydantic's EmailStr);
* a likely typo in a common provider's domain ("gmial.com" -> "gmail.com");
* Gmail's own username rules (6-30 letters, digits and dots);
* whether the domain exists and accepts mail (DNS MX record).

Whether a particular mailbox exists (e.g. no such Gmail user) can only be learned by sending: the provider
answers with a hard bounce, which delivery_status() reads back from Brevo.
"""
from __future__ import annotations

import re
import sys
from functools import lru_cache

COMMON_DOMAINS = ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "ymail.com", "live.com")
GMAIL_DOMAINS = ("gmail.com", "googlemail.com")
_GMAIL_USER = re.compile(r"^[a-z0-9](?:[a-z0-9]|\.(?!\.))*[a-z0-9]$")


class InvalidEmail(ValueError):
    """The address cannot receive mail; the message says why in plain words."""


def _distance(a: str, b: str) -> int:
    """Damerau-Levenshtein distance (adjacent swaps count as one edit)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def suggest_domain(domain: str) -> str | None:
    """A common provider's domain one or two edits away, e.g. gmial.com -> gmail.com."""
    if domain in COMMON_DOMAINS:
        return None
    best = min(COMMON_DOMAINS, key=lambda c: _distance(domain, c))
    return best if _distance(domain, best) <= 2 else None


@lru_cache(maxsize=512)
def _has_mx(domain: str) -> bool | None:
    """True/False when DNS answers; None when DNS cannot be used here (then nothing is blocked)."""
    if sys.platform == "emscripten":
        return None
    try:
        import dns.exception
        import dns.resolver
    except ImportError:
        return None
    resolver = dns.resolver.Resolver()
    resolver.lifetime = 4.0

    def lookup(name: str) -> bool:
        try:
            resolver.resolve(name, "MX")
            return True
        except dns.resolver.NoAnswer:
            try:  # a domain with only an A record can still receive mail
                resolver.resolve(name, "A")
                return True
            except Exception:
                return False

    try:
        return lookup(domain)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
        # Make sure DNS itself works here before calling the domain missing.
        try:
            return False if lookup("gmail.com") else None
        except Exception:
            return None
    except dns.exception.DNSException:
        return None


def check_address(email: str) -> str:
    """Return the cleaned address, or raise InvalidEmail with a plain message."""
    email = (email or "").strip().lower()
    if email.count("@") != 1:
        raise InvalidEmail("Enter a valid email address.")
    user, domain = email.split("@")
    if not user or "." not in domain:
        raise InvalidEmail("Enter a valid email address.")
    guess = suggest_domain(domain)
    if guess:
        raise InvalidEmail(f"Check the email address. Did you mean {user}@{guess}?")
    if domain in GMAIL_DOMAINS:
        bare = user.split("+", 1)[0]
        letters = bare.replace(".", "")
        if not (6 <= len(letters) <= 30) or not _GMAIL_USER.match(bare):
            raise InvalidEmail("This is not a valid Gmail address. Gmail usernames have 6 to 30 letters, "
                               "numbers and periods.")
        return email
    if domain not in COMMON_DOMAINS and _has_mx(domain) is False:
        raise InvalidEmail(f"The email domain {domain} does not exist or cannot receive email.")
    return email


# ---- after sending: did it bounce? ----------------------------------------------------------
BOUNCED = ("hardBounces", "invalid", "blocked", "error")


def delivery_status(api_key: str, message_id: str) -> tuple[str | None, str]:
    """Ask Brevo what happened to one message. Returns ("delivered" | "bounced" | None, reason)."""
    import httpx

    resp = httpx.get("https://api.brevo.com/v3/smtp/statistics/events",
                     params={"messageId": message_id, "limit": 20},
                     headers={"api-key": api_key, "accept": "application/json"}, timeout=10)
    if resp.status_code >= 300:
        return None, ""
    events = resp.json().get("events") or []
    for ev in events:
        if ev.get("event") in BOUNCED:
            return "bounced", ev.get("reason") or ev.get("event")
    if any(ev.get("event") == "delivered" for ev in events):
        return "delivered", ""
    return None, ""
