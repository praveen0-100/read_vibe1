"""Share links: a read-only public page of one document's highlights (and, optionally, notes), with an expiry and instant revoke.

Only a SHA-256 of the link token is stored, so a database leak does not expose working links; the full link is shown once, at
creation. The public endpoint answers an unknown, expired and revoked token identically (404) so tokens can't be probed.
"""
import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Highlight, ShareLink, aware, utcnow
from ..serializers import iso

router = APIRouter(tags=["shares"])
MAX_ACTIVE = 25


class ShareIn(BaseModel):
    document_id: str
    expires_days: int = Field(default=14, ge=1, le=90)
    include_notes: bool = False


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _out(s: ShareLink, title: str | None = None) -> dict:
    now = utcnow()
    return {"id": s.id, "document_id": s.document_id, "title": title, "include_notes": s.include_notes, "views": s.views,
            "created_at": iso(s.created_at), "expires_at": iso(s.expires_at),
            "status": "revoked" if s.revoked else "expired" if aware(s.expires_at) <= now else "active"}


@router.post("/shares", status_code=201)
def create_share(body: ShareIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    active = [s for s in db.scalars(select(ShareLink).where(ShareLink.owner_id == user.id, ShareLink.revoked.is_(False))) if aware(s.expires_at) > utcnow()]
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(status_code=409, detail="Too many active share links — revoke one first")
    token = secrets.token_urlsafe(24)
    s = ShareLink(owner_id=user.id, document_id=doc.id, token_hash=_hash(token), include_notes=body.include_notes, expires_at=utcnow() + timedelta(days=body.expires_days))
    db.add(s)
    db.commit()
    return {**_out(s, doc.title), "token": token, "path": f"/s/{token}"}  # the only time the token is revealed


@router.get("/shares")
def my_shares(user: CurrentUser, db: DB):
    from ..models import Document
    titles = dict(db.execute(select(Document.id, Document.title).where(Document.owner_id == user.id)).all())
    rows = db.scalars(select(ShareLink).where(ShareLink.owner_id == user.id).order_by(ShareLink.created_at.desc()).limit(100)).all()
    return [_out(s, titles.get(s.document_id)) for s in rows]


@router.delete("/shares/{share_id}", status_code=204)
def revoke_share(share_id: str, user: CurrentUser, db: DB):
    s = get_owned(db, ShareLink, user, share_id, "Share link")
    s.revoked = True
    db.commit()


@router.get("/shared/{token}")
def public_view(token: str, db: DB):
    """Public, no sign-in. Returns only what the owner chose to share."""
    s = db.scalar(select(ShareLink).where(ShareLink.token_hash == _hash(token)))
    if s is None or s.revoked or aware(s.expires_at) <= utcnow():
        raise HTTPException(status_code=404, detail="This link is no longer available")
    from ..models import Document
    doc = db.get(Document, s.document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="This link is no longer available")
    chapters = {c.position: c.title for c in doc.chapters}
    items = []
    for h in db.scalars(select(Highlight).where(Highlight.document_id == doc.id, Highlight.owner_id == s.owner_id).order_by(Highlight.chapter_index, Highlight.created_at)):
        item = {"text": h.text, "chapter": chapters.get(h.chapter_index, ""), "marks": {k: v for k, v in (h.marks or {}).items() if v}, "category": h.category, "pinned": bool(h.pinned)}
        if s.include_notes and h.note:
            item["note"] = h.note
        items.append(item)
    s.views = (s.views or 0) + 1
    db.commit()
    return {"title": doc.title, "author": doc.author, "highlights": items, "expires_at": iso(s.expires_at), "note": "Shared read-only from ReadVibe."}
