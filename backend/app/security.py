"""Authentication (JWT bearer tokens) and role-based access dependencies."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User
from .security_hashing import hash_password, verify_password  # noqa: F401  (re-export)

_bearer = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"


def create_token(user: User, remember: bool = False) -> str:
    """Session token. "Remember me" sessions last REMEMBER_ME_DAYS instead of JWT_TTL_MINUTES."""
    now = datetime.now(timezone.utc)
    ttl = timedelta(days=settings.remember_me_days) if remember else timedelta(minutes=settings.jwt_ttl_minutes)
    payload = {"sub": str(user.id), "role": user.role, "tv": user.token_version or 0, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _unauthorized(msg: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, msg, headers={"WWW-Authenticate": "Bearer"})


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise _unauthorized("Invalid or expired token")
    from .services import death

    death.process_due(db)  # activate any executor report whose waiting period has ended
    user = db.get(User, int(payload.get("sub", 0)))
    if (user is None or not user.active or user.password_hash is None or user.role != payload.get("role")
            or (user.role == "owner" and user.email_verified_at is None)
            or payload.get("tv", 0) != (user.token_version or 0)):  # signed out by a password reset/change
        raise _unauthorized("Account not available")
    return user


def require_owner(user: User = Depends(current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner account required")
    return user


def require_living_owner(user: User = Depends(require_owner)) -> User:
    if user.death_triggered_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This vault is sealed: the death trigger has been activated")
    return user


def require_beneficiary(user: User = Depends(current_user)) -> User:
    if user.role != "beneficiary":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Beneficiary account required")
    return user
