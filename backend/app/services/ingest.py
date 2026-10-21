"""Document ingestion pipeline: store → extract → segment → index (runs as a background job)."""
from __future__ import annotations

import random

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import Chapter, Document
from . import extraction, jobs, nlp, storage

COLORS = ["coral", "blue", "lavender", "amber", "green", "rose"]


def _title_from_filename(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0]
    return " ".join(stem.replace("_", " ").replace("-", " ").split()).title()[:300] or "Untitled document"


def write_chapters(db: Session, doc: Document, chapters: list[extraction.ExtractedChapter]) -> None:
    doc.chapters.clear()
    db.flush()
    for i, ch in enumerate(chapters):
        doc.chapters.append(Chapter(position=i, title=ch.title[:300], content=ch.content, word_count=ch.word_count))
    doc.word_count = sum(c.word_count for c in chapters)


def describe(chapters: list[extraction.ExtractedChapter]) -> tuple[str, list[str]]:
    text = "\n\n".join(c.content for c in chapters[:3])[:200_000]
    lead = nlp.top_sentences(text, 2)
    sample = "\n\n".join(c.content[:20_000] for c in chapters[:40])  # bounded work for huge files
    tags = [t for t in nlp.key_phrases(sample, 4) if len(t) < 24][:3]
    return " ".join(lead)[:600], tags


def _new_upload_doc(db: Session, owner_id: str, filename: str) -> Document:
    ext = filename.rsplit(".", 1)[-1].upper() if "." in filename else "TXT"
    doc = Document(
        owner_id=owner_id,
        title=_title_from_filename(filename),
        author="Processing…",
        file_format="MD" if ext == "MARKDOWN" else ext,
        status="processing",
        color=random.choice(COLORS),
    )
    db.add(doc)
    db.flush()
    return doc


def _queue(db: Session, owner_id: str, doc: Document, filename: str) -> str:
    job = jobs.create_job(db, owner_id, "document", f"Processing “{doc.title}”", ref_id=doc.id)
    jobs.submit(job.id, lambda ctx: _process(ctx, doc.id, filename))
    return job.id


def create_from_upload(db: Session, owner_id: str, filename: str, data: bytes) -> tuple[Document, str]:
    """In-memory variant (small files, imports, tests)."""
    doc = _new_upload_doc(db, owner_id, filename)
    doc.file_size = len(data)
    doc.file_path = storage.save(owner_id, f"documents/{doc.id}", filename, data)
    db.commit()
    return doc, _queue(db, owner_id, doc, filename)


async def create_from_stream(db: Session, owner_id: str, filename: str, upload, max_bytes: int) -> tuple[Document, str]:
    """Streams an upload of any size (up to `max_bytes`) straight to disk, then queues processing."""
    doc = _new_upload_doc(db, owner_id, filename)
    try:
        doc.file_path, doc.file_size = await storage.save_stream(owner_id, f"documents/{doc.id}", filename, upload, max_bytes)
    except BaseException:
        db.rollback()
        raise
    if doc.file_size == 0:
        storage.delete(doc.file_path)
        db.rollback()
        raise extraction.ExtractionError("The file is empty")
    db.commit()
    return doc, _queue(db, owner_id, doc, filename)


def _process(ctx: jobs.JobContext, document_id: str, filename: str) -> dict:
    ctx.update("Reading file", 10)
    with SessionLocal() as db:
        doc = db.get(Document, document_id)
        if doc is None:
            raise RuntimeError("Document was deleted during processing")
        path = storage.resolve(doc.file_path)
        ctx.update("Extracting text", 30)
        try:
            extracted = extraction.extract(filename, path)  # reads from disk; large files are never loaded whole
        except extraction.ExtractionError as exc:
            doc.status, doc.error, doc.author = "failed", str(exc), "—"
            db.commit()
            raise
        ctx.update("Splitting into chapters", 60)
        write_chapters(db, doc, extracted.chapters)
        ctx.update("Analysing content", 80)
        description, tags = describe(extracted.chapters)
        if extracted.title and len(extracted.title) > 3 and not extracted.title.lower().startswith(("microsoft", "untitled")):
            doc.title = extracted.title[:300]
        doc.author = (extracted.author or "Unknown author")[:200]
        doc.doc_type = extraction.guess_doc_type(extracted, filename)
        doc.description = description
        if extracted.truncated:
            doc.description = (
                "Note: this file is very large, so only the first part of its text was imported for reading. "
                "The full original file is stored and can be downloaded. " + description
            )
        doc.tags = tags
        doc.status = "ready"
        doc.error = None
        db.commit()
        ctx.update("Building search index", 95)
        return {"document_id": doc.id, "chapters": len(extracted.chapters), "words": doc.word_count,
                "title": doc.title, "truncated": extracted.truncated}


def create_from_text(db: Session, owner_id: str, title: str, author: str, content: str, doc_type: str, tags: list[str]) -> Document:
    chapters = extraction.split_into_chapters(content)
    if not chapters:
        raise extraction.ExtractionError("The text is empty")
    doc = Document(
        owner_id=owner_id, title=title, author=author, doc_type=doc_type, file_format="TXT",
        file_size=len(content.encode()), status="ready", color=random.choice(COLORS), tags=tags,
    )
    db.add(doc)
    db.flush()
    write_chapters(db, doc, chapters)
    desc, auto_tags = describe(chapters)
    doc.description = desc
    if not tags:
        doc.tags = auto_tags
    db.commit()
    db.refresh(doc)
    return doc
