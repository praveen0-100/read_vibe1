"""Study notebook: notes, highlights and saved AI outputs in one place."""
from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import select

from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Document, Highlight, Note
from ..schemas import NoteCreate, NoteUpdate
from ..serializers import highlight_out, note_out

router = APIRouter(prefix="/notes", tags=["notes"])


def _titles(db, user_id: str) -> dict[str, str]:
    return dict(db.execute(select(Document.id, Document.title).where(Document.owner_id == user_id)).all())


@router.get("")
def list_notes(user: CurrentUser, db: DB, document_id: str | None = None, category: str | None = None, q: str | None = None):
    stmt = select(Note).where(Note.owner_id == user.id)
    if document_id:
        stmt = stmt.where(Note.document_id == document_id)
    if category:
        stmt = stmt.where(Note.category == category)
    rows = db.scalars(stmt.order_by(Note.pinned.desc(), Note.created_at.desc())).all()
    if q:
        ql = q.lower()
        rows = [n for n in rows if ql in n.title.lower() or ql in (n.content or "").lower() or ql in (n.quote or "").lower()]
    titles = _titles(db, user.id)
    return [note_out(n, titles.get(n.document_id)) for n in rows]


@router.get("/notebook")
def notebook(user: CurrentUser, db: DB):
    """Unified study notebook: notes + highlights, grouped by document."""
    titles = _titles(db, user.id)
    notes = db.scalars(select(Note).where(Note.owner_id == user.id).order_by(Note.created_at.desc())).all()
    highlights = db.scalars(select(Highlight).where(Highlight.owner_id == user.id).order_by(Highlight.created_at.desc())).all()
    return {
        "notes": [note_out(n, titles.get(n.document_id)) for n in notes],
        "highlights": [{**highlight_out(h), "document_title": titles.get(h.document_id)} for h in highlights],
    }


@router.post("", status_code=201)
def create_note(body: NoteCreate, user: CurrentUser, db: DB):
    if body.document_id:
        get_owned_document(db, user, body.document_id)
    n = Note(owner_id=user.id, **body.model_dump())
    db.add(n)
    db.commit()
    return note_out(n, _titles(db, user.id).get(n.document_id))


@router.patch("/{note_id}")
def update_note(note_id: str, body: NoteUpdate, user: CurrentUser, db: DB):
    n = get_owned(db, Note, user, note_id, "Note")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(n, k, v)
    db.commit()
    return note_out(n, _titles(db, user.id).get(n.document_id))


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str, user: CurrentUser, db: DB):
    n = get_owned(db, Note, user, note_id, "Note")
    db.delete(n)
    db.commit()


@router.get("/export/markdown")
def export_notebook(user: CurrentUser, db: DB):
    titles = _titles(db, user.id)
    notes = db.scalars(select(Note).where(Note.owner_id == user.id).order_by(Note.document_id, Note.created_at)).all()
    highlights = db.scalars(select(Highlight).where(Highlight.owner_id == user.id).order_by(Highlight.document_id, Highlight.chapter_index)).all()
    lines = ["# ReadVibe Study Notebook", ""]
    doc_ids = list(dict.fromkeys([n.document_id for n in notes] + [h.document_id for h in highlights]))
    for doc_id in doc_ids:
        lines += [f"## {titles.get(doc_id, 'General notes') if doc_id else 'General notes'}", ""]
        for h in [h for h in highlights if h.document_id == doc_id]:
            lines.append(f"> {h.text}  \n> — *{h.category}*" + (f"\n\n{h.note}" if h.note else ""))
            lines.append("")
        for n in [n for n in notes if n.document_id == doc_id]:
            lines.append(f"### {n.title} ({n.category})")
            if n.quote:
                lines.append(f"> {n.quote}")
            lines += [n.content or "", ""]
    return Response("\n".join(lines), media_type="text/markdown",
                    headers={"Content-Disposition": 'attachment; filename="readvibe-notebook.md"'})
