"""Library, reading content, progress, highlights and bookmarks."""
import re
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select

from ..config import get_settings
from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Audiobook, Bookmark, Chapter, Document, Highlight, utcnow
from ..schemas import (
    BookmarkCreate,
    DocumentCreateText,
    DocumentUpdate,
    HighlightCreate,
    HighlightUpdate,
    ProgressUpdate,
)
from ..serializers import bookmark_out, document_out, highlight_out
from ..services import extraction, ingest, storage

router = APIRouter(prefix="/documents", tags=["documents"])


def _audio_doc_ids(db, user_id: str) -> set[str]:
    return set(db.scalars(select(Audiobook.document_id).where(Audiobook.owner_id == user_id, Audiobook.status == "ready")))


@router.get("")
def list_documents(
    user: CurrentUser,
    db: DB,
    q: str | None = None,
    type: Literal["BOOK", "PAPER", "DOCUMENT"] | None = None,
    favorites: bool = False,
    offline: bool = False,
    tag: str | None = None,
    sort: Literal["recent", "title", "progress", "added", "type"] = "recent",
):
    stmt = select(Document).where(Document.owner_id == user.id)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Document.title).like(like), func.lower(Document.author).like(like), func.lower(Document.description).like(like)))
    if type:
        stmt = stmt.where(Document.doc_type == type)
    if favorites:
        stmt = stmt.where(Document.favorite.is_(True))
    if offline:
        stmt = stmt.where(Document.offline.is_(True))
    docs = db.scalars(stmt).all()
    if tag:
        docs = [d for d in docs if tag.lower() in [t.lower() for t in d.tags or []]]
    keyfuncs = {
        "recent": lambda d: (d.pinned, (d.last_opened_at or d.created_at).timestamp()),
        "title": lambda d: d.title.lower(),
        "progress": lambda d: d.progress,
        "added": lambda d: d.created_at.timestamp(),
        "type": lambda d: (d.doc_type, d.title.lower()),
    }
    docs = sorted(docs, key=keyfuncs[sort], reverse=sort in ("recent", "progress", "added"))
    audio = _audio_doc_ids(db, user.id)
    return [document_out(d, with_chapters=False, audio_ready=d.id in audio) for d in docs]


@router.get("/tags")
def list_tags(user: CurrentUser, db: DB):
    counts: dict[str, int] = {}
    for tags in db.scalars(select(Document.tags).where(Document.owner_id == user.id)):
        for t in tags or []:
            counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(counts.items(), key=lambda kv: -kv[1])]


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(request: Request, user: CurrentUser, db: DB, file: UploadFile = File(...)):
    settings = get_settings()
    filename = file.filename or "document.txt"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in extraction.SUPPORTED_FORMATS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Supported: {', '.join(sorted(extraction.SUPPORTED_FORMATS))}")
    limit = settings.max_upload_mb * 1024 * 1024
    human = f"{settings.max_upload_mb / 1024:g} GB" if settings.max_upload_mb >= 1024 else f"{settings.max_upload_mb} MB"
    # Reject early when the client declares an oversized body (the streaming check below is authoritative).
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Files must be {human} or smaller")
    try:
        doc, job_id = await ingest.create_from_stream(db, user.id, filename, file, limit)
    except storage.TooLarge as exc:
        raise HTTPException(status_code=413, detail=f"Files must be {human} or smaller") from exc
    except extraction.ExtractionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"document": document_out(doc, with_chapters=False), "job_id": job_id}


@router.post("/text", status_code=status.HTTP_201_CREATED)
def create_text_document(body: DocumentCreateText, user: CurrentUser, db: DB):
    try:
        doc = ingest.create_from_text(db, user.id, body.title, body.author, body.content, body.doc_type, body.tags)
    except extraction.ExtractionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return document_out(doc)


@router.get("/{document_id}")
def get_document(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    return document_out(doc, audio_ready=doc.id in _audio_doc_ids(db, user.id))


@router.patch("/{document_id}")
def update_document(document_id: str, body: DocumentUpdate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(doc, field, value)
    db.commit()
    return document_out(doc)


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    storage.delete(doc.file_path)
    db.delete(doc)
    db.commit()


@router.post("/{document_id}/open")
def mark_opened(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    doc.last_opened_at = utcnow()
    db.commit()
    return {"ok": True}


@router.get("/{document_id}/chapters/{index}")
def get_chapter(document_id: str, index: int, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    if doc.status != "ready":
        raise HTTPException(status_code=409, detail=f"Document is {doc.status}")
    ch = db.scalar(select(Chapter).where(Chapter.document_id == doc.id, Chapter.position == index))
    if not ch:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return {"index": ch.position, "title": ch.title, "content": ch.content, "word_count": ch.word_count, "total": len(doc.chapters)}


@router.get("/{document_id}/package")
def offline_package(document_id: str, user: CurrentUser, db: DB):
    """Everything needed to read the document offline in one response."""
    doc = get_owned_document(db, user, document_id)
    return {
        "document": document_out(doc),
        "chapters": [{"index": c.position, "title": c.title, "content": c.content} for c in doc.chapters],
        "highlights": [highlight_out(h) for h in db.scalars(select(Highlight).where(Highlight.document_id == doc.id))],
        "bookmarks": [bookmark_out(b) for b in db.scalars(select(Bookmark).where(Bookmark.document_id == doc.id))],
    }


@router.get("/{document_id}/file")
def download_file(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    if not doc.file_path:
        raise HTTPException(status_code=404, detail="No original file for this document")
    path = storage.resolve(doc.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage")
    return FileResponse(path, filename=f"{storage.safe_name(doc.title)}.{doc.file_format.lower()}")


@router.put("/{document_id}/progress")
def update_progress(document_id: str, body: ProgressUpdate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    total_words = doc.word_count or 1
    before = sum(c.word_count for c in doc.chapters[: body.chapter_index])
    current = doc.chapters[body.chapter_index].word_count if body.chapter_index < len(doc.chapters) else 0
    progress = min(100.0, 100.0 * (before + current * body.scroll_ratio) / total_words)
    doc.current_chapter = min(body.chapter_index, max(0, len(doc.chapters) - 1))
    doc.scroll_ratio = body.scroll_ratio
    doc.progress = round(progress, 2)
    doc.last_opened_at = utcnow()
    if body.mode:
        doc.last_mode = body.mode
    db.commit()
    return {"progress": doc.progress, "current_chapter": doc.current_chapter}


@router.get("/{document_id}/search")
def search_in_document(document_id: str, user: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=200)):
    doc = get_owned_document(db, user, document_id)
    pattern = re.compile(re.escape(q), re.IGNORECASE)
    matches = []
    for ch in doc.chapters:
        title_hit = bool(pattern.search(ch.title))
        for m in pattern.finditer(ch.content):
            start, end = max(0, m.start() - 70), min(len(ch.content), m.end() + 70)
            matches.append({
                "chapter_index": ch.position,
                "chapter_title": ch.title,
                "offset": m.start(),
                "before": ("…" if start else "") + ch.content[start : m.start()].replace("\n", " "),
                "match": m.group(0),
                "after": ch.content[m.end() : end].replace("\n", " ") + ("…" if end < len(ch.content) else ""),
            })
            if len(matches) >= 300:
                break
        if title_hit and not any(x["chapter_index"] == ch.position for x in matches):
            matches.append({"chapter_index": ch.position, "chapter_title": ch.title, "offset": 0, "before": "", "match": ch.title, "after": " (chapter title)"})
    return {"query": q, "total": len(matches), "matches": matches}


# ─── Highlights ───────────────────────────────────────────────────────────────
@router.get("/{document_id}/highlights")
def list_highlights(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    rows = db.scalars(select(Highlight).where(Highlight.document_id == doc.id).order_by(Highlight.chapter_index, Highlight.created_at))
    return [highlight_out(h) for h in rows]


@router.post("/{document_id}/highlights", status_code=201)
def create_highlight(document_id: str, body: HighlightCreate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    h = Highlight(owner_id=user.id, document_id=doc.id, **body.model_dump())
    db.add(h)
    db.commit()
    return highlight_out(h)


@router.patch("/highlights/{highlight_id}")
def update_highlight(highlight_id: str, body: HighlightUpdate, user: CurrentUser, db: DB):
    h = get_owned(db, Highlight, user, highlight_id, "Highlight")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(h, k, v)
    db.commit()
    return highlight_out(h)


@router.delete("/highlights/{highlight_id}", status_code=204)
def delete_highlight(highlight_id: str, user: CurrentUser, db: DB):
    h = get_owned(db, Highlight, user, highlight_id, "Highlight")
    db.delete(h)
    db.commit()


# ─── Bookmarks ────────────────────────────────────────────────────────────────
@router.get("/{document_id}/bookmarks")
def list_bookmarks(document_id: str, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    rows = db.scalars(select(Bookmark).where(Bookmark.document_id == doc.id).order_by(Bookmark.chapter_index, Bookmark.scroll_ratio))
    return [bookmark_out(b) for b in rows]


@router.post("/{document_id}/bookmarks", status_code=201)
def create_bookmark(document_id: str, body: BookmarkCreate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, document_id)
    b = Bookmark(owner_id=user.id, document_id=doc.id, **body.model_dump())
    db.add(b)
    db.commit()
    return bookmark_out(b)


@router.delete("/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(bookmark_id: str, user: CurrentUser, db: DB):
    b = get_owned(db, Bookmark, user, bookmark_id, "Bookmark")
    db.delete(b)
    db.commit()
