"""Listening state that follows the account (play queue + playlists) and the unified Source → Artifact view."""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import DB, CurrentUser, get_owned_document
from ..models import Audiobook, Deck, PlaybackState
from ..serializers import iso

router = APIRouter(tags=["playback"])

MAX_QUEUE = 500
MAX_PLAYLISTS = 100
MAX_PLAYLIST_ITEMS = 1000


class StateIn(BaseModel):
    queue: dict = Field(default_factory=dict)
    playlists: list = Field(default_factory=list)
    client_updated_at: int = Field(ge=0)


def _state_out(row: PlaybackState | None, applied: bool = True) -> dict:
    if row is None:
        return {"queue": {}, "playlists": [], "client_updated_at": 0, "applied": applied}
    return {"queue": row.queue or {}, "playlists": row.playlists or [], "client_updated_at": row.client_updated_at, "applied": applied}


def _clean_queue(q: dict) -> dict:
    """Keep only the shape the player understands and bound its size (the body is user-controlled)."""
    def rows(key: str) -> list:
        return [r for r in (q.get(key) or []) if isinstance(r, dict) and isinstance(r.get("id"), str)][:MAX_QUEUE]

    return {
        "queue": rows("queue"),
        "history": rows("history")[:40],
        "shuffle": bool(q.get("shuffle", False)),
        "repeat": q.get("repeat") if q.get("repeat") in ("off", "all", "one") else "off",
    }


def _clean_playlists(lists: list) -> list:
    out = []
    for p in lists[:MAX_PLAYLISTS]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str):
            continue
        ids = [i for i in (p.get("ids") or []) if isinstance(i, str)][:MAX_PLAYLIST_ITEMS]
        out.append({"id": p["id"], "name": str(p.get("name") or "Playlist")[:60], "ids": list(dict.fromkeys(ids)), "created": p.get("created", 0)})
    return out


@router.get("/playback/state")
def get_state(user: CurrentUser, db: DB):
    return _state_out(db.get(PlaybackState, user.id))


@router.put("/playback/state")
def put_state(body: StateIn, user: CurrentUser, db: DB):
    """Last writer wins by `client_updated_at`. A stale write is ignored and the newer server copy is returned (`applied: false`)."""
    row = db.get(PlaybackState, user.id)
    if row and row.client_updated_at > body.client_updated_at:
        return _state_out(row, applied=False)
    if row is None:
        row = PlaybackState(owner_id=user.id)
        db.add(row)
    row.queue = _clean_queue(body.queue)
    row.playlists = _clean_playlists(body.playlists)
    row.client_updated_at = body.client_updated_at
    db.commit()
    return _state_out(row)


@router.get("/sources/{document_id}/artifacts")
def source_artifacts(document_id: str, user: CurrentUser, db: DB):
    """Everything generated from one uploaded source, with the provenance each artifact must carry."""
    doc = get_owned_document(db, user, document_id)
    source = {"id": doc.id, "title": doc.title, "format": doc.file_format, "word_count": doc.word_count, "size_bytes": doc.file_size}
    artifacts = [{
        "id": f"reader:{doc.id}", "type": "reader", "title": doc.title, "language": "source", "status": doc.status,
        "source": source, "configuration": {}, "created_at": iso(doc.created_at), "artwork": {"kind": "generated", "color": doc.color},
    }]
    for b in db.scalars(select(Audiobook).where(Audiobook.document_id == doc.id, Audiobook.owner_id == user.id).order_by(Audiobook.created_at)):
        artifacts.append({
            "id": b.id, "type": "audiobook", "title": b.title, "language": "source", "status": b.status, "source": source,
            "configuration": {"tone": b.tone, "voice": b.voice, "rate": b.rate, "pitch": b.pitch},
            "duration_seconds": b.duration_seconds, "chapters": len(b.script or []),
            "created_at": iso(b.created_at), "artwork": {"kind": "generated", "color": doc.color},
        })
    for d in db.scalars(select(Deck).where(Deck.document_id == doc.id, Deck.owner_id == user.id).order_by(Deck.created_at)):
        artifacts.append({
            "id": d.id, "type": "presentation", "title": d.title, "language": "source", "status": d.status, "source": source,
            "configuration": {"theme": d.theme}, "slides": len(d.slides or []),
            "created_at": iso(d.created_at), "artwork": {"kind": "generated", "color": doc.color},
        })
    return {"source": source, "artifacts": artifacts}
