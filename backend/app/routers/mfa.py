"""Two-factor authentication (authenticator app + one-time recovery codes) and the account's security log."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import get_settings
from ..deps import DB, CurrentUser
from ..models import AuditEvent, User, aware
from ..security import decode_purpose_token, verify_password
from ..serializers import iso
from ..services import audit, secretbox, totp
from .auth import NO_PASSWORD, _token_response

router = APIRouter(prefix="/auth", tags=["security"])


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class DisableIn(CodeIn):
    password: str = Field(default="", max_length=128)


class VerifyIn(CodeIn):
    mfa_token: str = Field(min_length=20, max_length=4096)


def check_second_factor(db, user: User, code: str) -> str | None:
    """'totp' / 'backup' when `code` is a valid authenticator code or an unused recovery code, else None.
    A TOTP step can be used once; a recovery code is burned when used."""
    seed = secretbox.unseal(user.totp_secret)
    if seed:
        step = totp.verify(seed, code, last_step=user.totp_last_step or 0)
        if step is not None:
            user.totp_last_step = step
            db.commit()
            return "totp"
    digest = totp.hash_backup_code(code)
    if digest in (user.backup_codes or []):
        user.backup_codes = [c for c in user.backup_codes if c != digest]
        db.commit()
        return "backup"
    return None


def _lock_if_needed(db, user: User) -> None:
    s = get_settings()
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= s.login_max_failures:
        user.failed_logins = 0
        user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=s.login_lockout_minutes)
    db.commit()


@router.get("/security")
def security_overview(user: CurrentUser, db: DB):
    events = db.scalars(select(AuditEvent).where(AuditEvent.owner_id == user.id).order_by(AuditEvent.created_at.desc()).limit(30)).all()
    return {
        "two_factor": bool(user.totp_enabled),
        "backup_codes_left": len(user.backup_codes or []),
        "has_password": user.password_hash != NO_PASSWORD,
        "events": [{"event": e.event, "ip": e.ip, "agent": e.agent, "at": iso(e.created_at)} for e in events],
    }


@router.post("/2fa/setup")
def setup(user: CurrentUser, db: DB):
    """Start enrolment: a fresh secret (not active until a code from the app confirms it)."""
    if user.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is already on")
    secret = totp.new_secret()
    user.totp_secret = secretbox.seal(secret)
    db.commit()
    return {"secret": secret, "otpauth_uri": totp.otpauth_uri(secret, user.email)}


@router.post("/2fa/enable")
def enable(body: CodeIn, request: Request, user: CurrentUser, db: DB):
    seed = secretbox.unseal(user.totp_secret)
    if user.totp_enabled or not seed:
        raise HTTPException(status_code=409, detail="Start setup first")
    step = totp.verify(seed, body.code)
    if step is None:
        raise HTTPException(status_code=400, detail="That code isn’t right. Check the time on your phone and try the next code.")
    codes = totp.new_backup_codes()
    user.totp_enabled, user.totp_last_step = True, step
    user.backup_codes = [totp.hash_backup_code(c) for c in codes]
    db.commit()
    audit.record(db, "mfa_enabled", user.id, audit.client_ip(request), request.headers.get("user-agent"))
    return {"enabled": True, "backup_codes": codes, "note": "Save these recovery codes now. Each works once and they will not be shown again."}


@router.post("/2fa/disable")
def disable(body: DisableIn, request: Request, user: CurrentUser, db: DB):
    if not user.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is not on")
    if user.password_hash != NO_PASSWORD and not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    if check_second_factor(db, user, body.code) is None:
        raise HTTPException(status_code=400, detail="That code isn’t right")
    user.totp_enabled, user.totp_secret, user.backup_codes, user.totp_last_step = False, None, [], 0
    db.commit()
    audit.record(db, "mfa_disabled", user.id, audit.client_ip(request), request.headers.get("user-agent"))
    return {"enabled": False}


@router.post("/2fa/verify")
def verify_login(body: VerifyIn, request: Request, db: DB):
    """Second step of sign-in: trade the short-lived mfa_token plus a code for a normal session."""
    user_id = decode_purpose_token(body.mfa_token, "mfa")
    user = db.get(User, user_id) if user_id else None
    if not user or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="This sign-in expired. Please start again.")
    ip, agent = audit.client_ip(request), request.headers.get("user-agent")
    now = datetime.now(timezone.utc)
    if aware(user.locked_until) and aware(user.locked_until) > now:
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait before trying again.", headers={"Retry-After": str(int((aware(user.locked_until) - now).total_seconds()) + 1)})
    kind = check_second_factor(db, user, body.code)
    if kind is None:
        _lock_if_needed(db, user)
        audit.record(db, "mfa_failed", user.id, ip, agent)
        raise HTTPException(status_code=401, detail="That code isn’t right")
    user.failed_logins, user.locked_until = 0, None
    db.commit()
    audit.record(db, "backup_code_used" if kind == "backup" else "login_success", user.id, ip, agent, method="mfa")
    return _token_response(user)
