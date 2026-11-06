"""Security audit trail: who did what, from where, when. Written for sign-in, lockouts, 2FA and password changes.

Entries hold no secrets (never passwords, codes or tokens). Users can read their own trail; it is the first thing to look at
after "was that me?".
"""
from __future__ import annotations

from ..models import AuditEvent
from . import metrics

EVENTS = {"login_success", "login_failed", "login_locked", "mfa_failed", "mfa_enabled", "mfa_disabled", "backup_code_used", "password_changed", "google_login"}


def record(db, event: str, user_id: str | None, ip: str | None = None, agent: str | None = None, **detail) -> None:
    db.add(AuditEvent(owner_id=user_id, event=event, ip=(ip or "")[:64], agent=(agent or "")[:200], detail=detail or {}))
    db.commit()
    metrics.incr(f"auth_{event}")


def client_ip(request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or ""
