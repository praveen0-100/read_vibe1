"""ORM → JSON serializers (kept explicit so API contracts are obvious)."""
from __future__ import annotations

from datetime import datetime

from .models import (
    Audiobook,
    Bookmark,
    Chapter,
    CollabProject,
    Document,
    Highlight,
    Job,
    Note,
    Recording,
    Reference,
    ResearchProject,
    User,
)

WORDS_PER_MINUTE = 230


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def user_out(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "preferences": user.preferences or {},
        "avatar_url": user.avatar_url,
        "google_linked": bool(user.google_sub),
        "has_password": user.password_hash != "!",
        "created_at": iso(user.created_at),
    }


def chapter_meta(ch: Chapter) -> dict:
    return {
        "index": ch.position,
        "title": ch.title,
        "word_count": ch.word_count,
        "minutes": max(1, round(ch.word_count / WORDS_PER_MINUTE)),
    }


def document_out(doc: Document, *, with_chapters: bool = True, audio_ready: bool = False) -> dict:
    minutes_total = max(1, round(doc.word_count / WORDS_PER_MINUTE)) if doc.word_count else 0
    minutes_left = round(minutes_total * (1 - doc.progress / 100)) if minutes_total else 0
    chapters = [chapter_meta(c) for c in doc.chapters] if with_chapters else []
    current_title = None
    if doc.chapters and 0 <= doc.current_chapter < len(doc.chapters):
        current_title = doc.chapters[doc.current_chapter].title
    return {
        "id": doc.id,
        "title": doc.title,
        "author": doc.author,
        "type": doc.doc_type,
        "format": doc.file_format,
        "description": doc.description,
        "tags": doc.tags or [],
        "color": doc.color,
        "status": doc.status,
        "error": doc.error,
        "word_count": doc.word_count,
        "file_size": doc.file_size,
        "has_file": bool(doc.file_path),
        "favorite": doc.favorite,
        "pinned": doc.pinned,
        "offline": doc.offline,
        "progress": round(doc.progress, 1),
        "current_chapter": doc.current_chapter,
        "current_chapter_title": current_title,
        "scroll_ratio": doc.scroll_ratio,
        "last_mode": doc.last_mode,
        "minutes_total": minutes_total,
        "minutes_left": minutes_left,
        "chapter_count": len(doc.chapters),
        "chapters": chapters,
        "audio_ready": audio_ready,
        "last_opened_at": iso(doc.last_opened_at),
        "created_at": iso(doc.created_at),
        "updated_at": iso(doc.updated_at),
    }


def sketch_out(s) -> dict:
    return {
        "id": s.id,
        "document_id": s.document_id,
        "chapter_index": s.chapter_index,
        "tool": s.tool,
        "color": s.color,
        "width": s.width,
        "points": s.points,
    }


def highlight_out(h: Highlight) -> dict:
    return {
        "id": h.id,
        "document_id": h.document_id,
        "chapter_index": h.chapter_index,
        "text": h.text,
        "category": h.category,
        "note": h.note,
        "created_at": iso(h.created_at),
    }


def bookmark_out(b: Bookmark) -> dict:
    return {
        "id": b.id,
        "document_id": b.document_id,
        "chapter_index": b.chapter_index,
        "scroll_ratio": b.scroll_ratio,
        "label": b.label,
        "created_at": iso(b.created_at),
    }


def note_out(n: Note, doc_title: str | None = None) -> dict:
    return {
        "id": n.id,
        "document_id": n.document_id,
        "document_title": doc_title,
        "chapter_index": n.chapter_index,
        "title": n.title,
        "content": n.content,
        "quote": n.quote,
        "category": n.category,
        "type": n.note_type,
        "ai_payload": n.ai_payload,
        "pinned": n.pinned,
        "created_at": iso(n.created_at),
        "updated_at": iso(n.updated_at),
    }


def job_out(j: Job) -> dict:
    return {
        "id": j.id,
        "kind": j.kind,
        "title": j.title,
        "status": j.status,
        "stage": j.stage,
        "progress": round(j.progress, 1),
        "ref_id": j.ref_id,
        "result": j.result,
        "error": j.error,
        "seen": j.seen,
        "created_at": iso(j.created_at),
        "updated_at": iso(j.updated_at),
    }


def audiobook_out(a: Audiobook, *, with_script: bool = False, doc: Document | None = None) -> dict:
    total_segments = sum(len(c.get("segments", [])) for c in a.script or [])
    done_segments = sum(len(c.get("segments", [])) for c in (a.script or [])[: a.position_chapter]) + a.position_segment
    data = {
        "id": a.id,
        "document_id": a.document_id,
        "title": a.title,
        "tone": a.tone,
        "voice": a.voice,
        "status": a.status,
        "rate": a.rate,
        "pitch": a.pitch,
        "duration_seconds": a.duration_seconds,
        "position_chapter": a.position_chapter,
        "position_segment": a.position_segment,
        "listened_seconds": a.listened_seconds,
        "progress": round(100 * done_segments / total_segments, 1) if total_segments else 0,
        "bookmarks": a.bookmarks or [],
        "chapters": [
            {"index": i, "title": c.get("title"), "seconds": c.get("seconds", 0), "segments": len(c.get("segments", []))}
            for i, c in enumerate(a.script or [])
        ],
        "color": doc.color if doc else "coral",
        "created_at": iso(a.created_at),
    }
    if with_script:
        data["script"] = a.script
    return data


def recording_out(r: Recording) -> dict:
    return {
        "id": r.id,
        "assignment_id": r.assignment_id,
        "mime_type": r.mime_type,
        "duration_seconds": r.duration_seconds,
        "created_at": iso(r.created_at),
    }


def collab_out(p: CollabProject, recordings: list[Recording] | None = None) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "document_id": p.document_id,
        "collaborators": p.collaborators or [],
        "assignments": p.assignments or [],
        "status": p.status,
        "recordings": [recording_out(r) for r in (recordings or [])],
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }


def reference_out(r: Reference) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "authors": r.authors or [],
        "year": r.year,
        "venue": r.venue,
        "abstract": r.abstract,
        "url": r.url,
        "doi": r.doi,
        "citations": r.citations,
        "relevance": round(r.relevance, 3),
        "provider": r.provider,
        "publication_type": r.publication_type,
        "open_access": r.open_access,
        "included": r.included,
        "summary": r.summary,
    }


SECTION_KEYS = ["abstract", "introduction", "literature_review", "methodology", "results", "conclusion"]


def research_out(p: ResearchProject, *, full: bool = True) -> dict:
    sections = p.sections or {}
    filled = sum(1 for k in SECTION_KEYS if (sections.get(k) or {}).get("content", "").strip())
    data = {
        "id": p.id,
        "title": p.title,
        "topic": p.topic,
        "status": p.status,
        "citation_style": p.citation_style,
        "tone": p.tone,
        "depth": p.depth,
        "source_document_ids": p.source_document_ids or [],
        "progress": round(100 * filled / len(SECTION_KEYS)),
        "reference_count": len(p.references),
        "included_count": sum(1 for r in p.references if r.included),
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }
    if full:
        data["outline"] = p.outline or []
        data["sections"] = {k: sections.get(k, {"content": "", "status": "empty", "versions": []}) for k in SECTION_KEYS}
        data["references"] = [reference_out(r) for r in p.references]
    return data
