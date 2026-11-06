"""Exports: study cards (Anki-importable / CSV) and a document's highlights (Markdown / CSV). Your data stays portable."""
import csv
import io
import re
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import select

from ..deps import DB, CurrentUser, get_owned_document
from ..models import Card, Highlight
from ..services.exporting import csv_cell, marks_label

router = APIRouter(tags=["exports"])


def _download(body: str, filename: str, media: str) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._") or "export"
    return Response(body.encode("utf-8-sig") if media == "text/csv" else body.encode(), media_type=f"{media}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.get("/study/export")
def export_cards(user: CurrentUser, db: DB, format: Literal["anki", "csv"] = "anki", document_id: str | None = Query(default=None)):
    stmt = select(Card).where(Card.owner_id == user.id).order_by(Card.created_at)
    if document_id:
        get_owned_document(db, user, document_id)
        stmt = stmt.where(Card.document_id == document_id)
    cards = db.scalars(stmt).all()
    if format == "anki":
        # Anki "Import File": tab-separated, one note per line, fields may contain HTML; real tabs/newlines must not leak in
        clean = lambda t: re.sub(r"\s*\n\s*", "<br>", t.replace("\t", " ").strip())  # noqa: E731
        lines = ["#separator:tab", "#html:true", "#columns:Front\tBack\tTags"] + [f"{clean(c.front)}\t{clean(c.back)}\treadvibe" for c in cards]
        return _download("\n".join(lines) + "\n", "readvibe-cards.txt", "text/plain")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["front", "back", "ease", "interval_days", "reps", "lapses", "due"])
    for c in cards:
        w.writerow([csv_cell(c.front), csv_cell(c.back), c.ease, c.interval_days, c.reps, c.lapses, c.due_at.isoformat() if c.due_at else ""])
    return _download(buf.getvalue(), "readvibe-cards.csv", "text/csv")


@router.get("/documents/{document_id}/highlights/export")
def export_highlights(document_id: str, user: CurrentUser, db: DB, format: Literal["md", "csv"] = "md"):
    doc = get_owned_document(db, user, document_id)
    titles = {c.position: c.title for c in doc.chapters}
    rows = db.scalars(select(Highlight).where(Highlight.document_id == doc.id, Highlight.owner_id == user.id).order_by(Highlight.chapter_index, Highlight.created_at)).all()
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["chapter", "text", "category", "styles", "note", "pinned"])
        for h in rows:
            w.writerow([csv_cell(titles.get(h.chapter_index, "")), csv_cell(h.text), h.category, marks_label(h.marks), csv_cell(h.note or ""), "yes" if h.pinned else ""])
        return _download(buf.getvalue(), f"{doc.title}-highlights.csv", "text/csv")
    out = [f"# {doc.title}", f"*{doc.author}* — {len(rows)} highlight{'s' if len(rows) != 1 else ''}", ""]
    current = None
    for h in rows:
        if h.chapter_index != current:
            current = h.chapter_index
            out += [f"## {titles.get(current, f'Section {current + 1}')}", ""]
        quote = " ".join(h.text.split())
        out.append(f"> {quote}" + (" 📌" if h.pinned else ""))
        meta = [m for m in (h.category, marks_label(h.marks)) if m]
        out.append(f"— *{' · '.join(meta)}*")
        if h.note:
            out += ["", f"**Note:** {h.note.strip()}"]
        out.append("")
    return _download("\n".join(out), f"{doc.title}-highlights.md", "text/markdown")
