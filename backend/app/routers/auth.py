"""Authentication and account management."""
import io
import json
import zipfile

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import get_settings
from ..deps import DB, CurrentUser
from ..models import Document, Highlight, Note, ResearchProject, User
from ..schemas import LoginIn, PasswordChange, PreferencesUpdate, ProfileUpdate, RegisterIn
from ..security import create_access_token, hash_password, verify_password
from ..serializers import document_out, highlight_out, note_out, research_out, user_out
from ..seed import DEMO_EMAIL, DEMO_PASSWORD
from ..services import google_auth, storage

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
    db.commit()
    return _token_response(user)


@router.post("/login")
def login(body: LoginIn, db: DB):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
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
def change_password(body: PasswordChange, user: CurrentUser, db: DB):
    # Google-only accounts have no password yet and may set one without a current password.
    if user.password_hash != NO_PASSWORD and not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()


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
