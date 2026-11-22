from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User, now_iso
from ..services.email_check import InvalidEmail, check_address
from ..security import create_token, current_user, hash_password, verify_password
from ..services import audit, verification

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class ActivateIn(BaseModel):
    email: EmailStr
    invite_code: str = Field(min_length=6, max_length=64)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember: bool = False


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


def user_out(u: User, db: Session | None = None) -> dict:
    out = {"id": u.id, "email": u.email, "display_name": u.display_name, "role": u.role,
           "death_triggered_at": u.death_triggered_at, "default_writing_mode": u.default_writing_mode}
    if u.role == "beneficiary":
        out.update(handle=u.handle, relationship=u.relationship)
        if db is not None and u.owner_id:
            from ..services import death

            owner = db.get(User, u.owner_id)
            out["owner"] = {"display_name": owner.display_name, "death_triggered": bool(owner.death_triggered_at)}
            out["is_executor"] = owner.executor_id == u.id
            if out["is_executor"]:
                from ..services.death import pending_report, report_out

                out["report"] = report_out(db, pending_report(db, owner.id))
                out["confirm_phrase"] = "REPORT PASSING"
    elif u.role == "owner" and db is not None:
        from ..services.death import pending_report, report_out

        ex = db.get(User, u.executor_id) if u.executor_id else None
        out["executor"] = {"id": ex.id, "display_name": ex.display_name} if ex else None
        out["pending_report"] = report_out(db, pending_report(db, u.id))
        from ..config import settings as _settings

        out["death_report_wait_minutes"] = _settings.death_report_wait_minutes
    return out


def _strong(pw: str) -> None:
    if not (re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw)):
        raise HTTPException(422, "Password must contain letters and numbers")


def hash_invite(code: str) -> str:
    """Invite codes are stored only as SHA-256 hashes."""
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def new_code() -> str:
    """A random one-time code such as K7QM-2XRD-9HTN (about 60 bits of entropy)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """Create an owner account and email a verification code. The account cannot be used until
    the email is verified (see /verify-email)."""
    _strong(body.password)
    try:
        email = check_address(body.email)
    except InvalidEmail as exc:
        raise HTTPException(422, str(exc))
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is not None and not (user.role == "owner" and user.email_verified_at is None):
        raise HTTPException(409, "An account with this email already exists")
    if user is None:
        user = User(role="owner", email=email, display_name=body.display_name.strip(),
                    password_hash=hash_password(body.password))
        db.add(user)
        db.flush()
        audit.record(db, user.id, user, "auth.register", {}, commit=False)
    else:  # an unfinished sign-up with this email: start it again
        user.display_name, user.password_hash = body.display_name.strip(), hash_password(body.password)
        user.verify_sent_at = None
        audit.record(db, user.id, user, "auth.register_again", {}, commit=False)
    db.commit()
    try:
        info = verification.send_code(db, user, verification.VERIFY)
    except verification.VerificationError as exc:
        raise HTTPException(429, str(exc))
    return {"verification_required": True, "email": user.email, **info}


class VerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResendIn(BaseModel):
    email: EmailStr


def _pending_owner(db: Session, email: str) -> User | None:
    u = db.scalars(select(User).where(User.email == email.lower())).first()
    return u if u is not None and u.role == "owner" and u.email_verified_at is None else None


@router.post("/verify-email")
def verify_email(body: VerifyIn, db: Session = Depends(get_db)):
    """Confirm the emailed code and sign the owner in."""
    user = _pending_owner(db, body.email)
    if user is None:
        raise HTTPException(400, "This email is already verified or has no pending sign-up. Try signing in")
    try:
        verification.verify(db, user, body.code)
    except verification.VerificationError as exc:
        raise HTTPException(400, str(exc))
    return {"token": create_token(user), "user": user_out(user, db)}


@router.post("/resend-verification")
def resend_verification(body: ResendIn, db: Session = Depends(get_db)):
    """Send a new code. The answer is the same whether or not the email has a pending sign-up."""
    user = _pending_owner(db, body.email)
    if user is None:
        return {"ok": True}
    try:
        info = verification.send_code(db, user)
    except verification.VerificationError as exc:
        raise HTTPException(429, str(exc))
    return {"ok": True, **info}


@router.post("/activate")
def activate(body: ActivateIn, db: Session = Depends(get_db)):
    _strong(body.password)
    user = db.scalars(select(User).where(User.email == body.email.lower(), User.role == "beneficiary")).first()
    if (user is None or not user.invite_code_hash or not user.active
            or not hmac.compare_digest(user.invite_code_hash, hash_invite(body.invite_code))):
        raise HTTPException(400, "Invalid email or invite code")
    user.password_hash = hash_password(body.password)
    user.invite_code_hash = None
    user.email_verified_at = user.email_verified_at or now_iso()  # the invite proved the address
    audit.record(db, user.owner_id, user, "auth.activate", {"handle": user.handle}, commit=False)
    db.commit()
    return {"token": create_token(user), "user": user_out(user, db)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.email == body.email.lower())).first()
    if user is None or not user.password_hash or not user.active or not verify_password(body.password, user.password_hash):
        if user is not None:
            audit.record(db, user.owner_id or user.id, None, "auth.login_failed", {"email": user.email})
        raise HTTPException(401, "Incorrect email or password")
    if user.role == "owner" and user.email_verified_at is None:
        # Only said after the correct password, so it reveals nothing to someone guessing.
        raise HTTPException(403, {"message": "Please verify your email address first.", "verify": True})
    from ..services import death

    death.process_due(db)  # a waiting report may have just come due
    db.refresh(user)
    audit.record(db, user.owner_id or user.id, user, "auth.login", {"remember": body.remember})
    return {"token": create_token(user, body.remember), "user": user_out(user, db), "remember": body.remember}


def _resettable(db: Session, email: str) -> User | None:
    u = db.scalars(select(User).where(User.email == email.lower())).first()
    if u is None or not u.active or u.password_hash is None:
        return None
    if u.role == "owner" and u.email_verified_at is None:
        return None
    return u


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    """Email a 6-digit reset code. The answer is the same whether or not the email has an account."""
    user = _resettable(db, body.email)
    if user is None:
        return {"ok": True}
    try:
        info = verification.send_code(db, user, verification.RESET)
    except verification.TooSoon:
        return {"ok": True}  # a code was sent moments ago; say nothing that reveals the account
    return {"ok": True, **{k: v for k, v in info.items() if k == "demo_code"}}


@router.post("/reset-password")
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    """Set a new password with the emailed code. Signs out every device."""
    user = _resettable(db, body.email)
    if user is None:
        raise HTTPException(400, "That code is not correct")
    _strong(body.new_password)
    try:
        verification.check_code(db, user, body.code, verification.RESET)
    except verification.VerificationError as exc:
        raise HTTPException(400, str(exc))
    user.password_hash = hash_password(body.new_password)
    user.token_version = (user.token_version or 0) + 1  # every existing session stops working
    audit.record(db, user.owner_id or user.id, user, "auth.password_reset", {}, commit=False)
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(user, db)


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash or ""):
        raise HTTPException(400, "Current password is incorrect")
    _strong(body.new_password)
    user.password_hash = hash_password(body.new_password)
    user.token_version = (user.token_version or 0) + 1  # other devices are signed out
    audit.record(db, user.owner_id or user.id, user, "auth.change_password", {}, commit=False)
    db.commit()
    return {"ok": True, "token": create_token(user)}  # a fresh token keeps this device signed in
