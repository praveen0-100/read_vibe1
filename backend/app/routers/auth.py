"""Authentication and account management."""
import io
import json
import zipfile

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..deps import DB, CurrentUser
from ..models import Document, Highlight, Note, ResearchProject, User, aware
from ..schemas import LoginIn, PasswordChange, PreferencesUpdate, ProfileUpdate, RegisterIn
from ..security import create_access_token, create_purpose_token, hash_password, verify_password
from ..serializers import document_out, highlight_out, note_out, research_out, user_out
from ..seed import DEMO_EMAIL, DEMO_PASSWORD
from ..services import audit, google_auth, storage

router = APIRouter(prefix="/auth", tags=["auth"])
NO_PASSWORD = "!"  # never matches verify_password()


def _token_response(user: User) -> dict:
    token, expires = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires.isoformat(), "user": user_out(user)}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: DB):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password), preferences={})
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two submits raced past the check above
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from None
    return _token_response(user)


_DUMMY_HASH = hash_password("timing-equaliser")  # verified when the email is unknown, so response time doesn't reveal which emails exist


@router.post("/login")
def login(body: LoginIn, request: Request, db: DB):
    s = get_settings()
    ip, agent = audit.client_ip(request), request.headers.get("user-agent")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    now = datetime.now(timezone.utc)
    if user and aware(user.locked_until) and aware(user.locked_until) > now:
        wait = int((aware(user.locked_until) - now).total_seconds()) + 1
        audit.record(db, "login_locked", user.id, ip, agent)
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {max(1, wait // 60)} minute(s).", headers={"Retry-After": str(wait)})
    if not user or not verify_password(body.password, user.password_hash):
        if not user:
            verify_password(body.password, _DUMMY_HASH)
        else:
            user.failed_logins = (user.failed_logins or 0) + 1
            if user.failed_logins >= s.login_max_failures:
                user.failed_logins = 0
                user.locked_until = now + timedelta(minutes=s.login_lockout_minutes)
            db.commit()
            audit.record(db, "login_failed", user.id, ip, agent)
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    user.failed_logins, user.locked_until = 0, None
    db.commit()
    if user.totp_enabled:
        # password was right, but the session only starts after the second factor
        return {"mfa_required": True, "mfa_token": create_purpose_token(user.id, "mfa", 5)}
    audit.record(db, "login_success", user.id, ip, agent)
    return _token_response(user)


@router.get("/config")
def auth_config():
    """Public: which sign-in methods the login page should offer."""
    return {"google_client_id": get_settings().google_client_id, "google_enabled": google_auth.enabled()}


class GoogleIn(BaseModel):
    credential: str = Field(min_length=20, max_length=8192)


@router.post("/google")
def google_login(body: GoogleIn, db: DB):
    """Sign in (or sign up) with a Google Identity Services ID token."""
    try:
        claims = google_auth.verify_credential(body.credential)
    except google_auth.GoogleAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    sub, email = claims["sub"], claims["email"].lower()
    user = db.scalar(select(User).where(User.google_sub == sub))
    if not user:
        # Link to an existing account with the same (Google-verified) email, else create one.
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.google_sub = sub
        else:
            name = (claims.get("name") or email.split("@")[0]).strip()[:120]
            user = User(email=email, name=name, password_hash=NO_PASSWORD, preferences={}, google_sub=sub)
            db.add(user)
    if claims.get("picture"):
        user.avatar_url = claims["picture"][:500]
    db.commit()
    return _token_response(user)


@router.post("/demo")
def demo_login(db: DB):
    """One-click access to the seeded demo workspace."""
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if not user:
        from ..seed import seed_demo

        seed_demo(db)
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if not user or not verify_password(DEMO_PASSWORD, user.password_hash):
        raise HTTPException(status_code=404, detail="Demo account is not available")
    return _token_response(user)


@router.get("/me")
def me(user: CurrentUser):
    return user_out(user)


@router.patch("/me")
def update_me(body: ProfileUpdate, user: CurrentUser, db: DB):
    if body.email and body.email.lower() != user.email:
        if db.scalar(select(User).where(User.email == body.email.lower())):
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = body.email.lower()
    if body.name:
        user.name = body.name.strip()
    db.commit()
    return user_out(user)


@router.put("/me/preferences")
def update_preferences(body: PreferencesUpdate, user: CurrentUser, db: DB):
    merged = dict(user.preferences or {})
    merged.update(body.preferences)
    user.preferences = merged
    db.commit()
    return user_out(user)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordChange, request: Request, user: CurrentUser, db: DB):
    # Google-only accounts have no password yet and may set one without a current password.
    if user.password_hash != NO_PASSWORD and not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    audit.record(db, "password_changed", user.id, audit.client_ip(request), request.headers.get("user-agent"))


@router.get("/me/export")
def export_data(user: CurrentUser, db: DB):
    """Download everything we store about the user (GDPR-style export)."""
    docs = db.scalars(select(Document).where(Document.owner_id == user.id)).all()
    payload = {
        "user": user_out(user),
        "documents": [document_out(d) for d in docs],
        "highlights": [highlight_out(h) for h in db.scalars(select(Highlight).where(Highlight.owner_id == user.id))],
        "notes": [note_out(n) for n in db.scalars(select(Note).where(Note.owner_id == user.id))],
        "research": [research_out(p) for p in db.scalars(select(ResearchProject).where(ResearchProject.owner_id == user.id))],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("readvibe-export.json", json.dumps(payload, indent=2))
        for d in docs:
            text = "\n\n".join(f"## {c.title}\n\n{c.content}" for c in d.chapters)
            zf.writestr(f"documents/{storage.safe_name(d.title)}.md", f"# {d.title}\n\n{text}")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="readvibe-export.zip"'})


@router.delete("/me", status_code=204)
def delete_account(user: CurrentUser, db: DB):
    for d in db.scalars(select(Document).where(Document.owner_id == user.id)):
        storage.delete(d.file_path)
    db.delete(user)
    db.commit()
