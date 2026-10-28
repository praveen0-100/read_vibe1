"""Presentation studio: documents (or uploaded files) → decks, editing, .pptx export and generated slide art."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select

from ..database import SessionLocal
from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Deck, Document
from ..schemas import DeckCreate, DeckStyle, DeckTheme, DeckUpdate
from ..serializers import iso
from ..services import art, deck as deck_svc, extraction, jobs, pptx_export

router = APIRouter(prefix="/decks", tags=["decks"])

MAX_UPLOAD_MB = 60


def _flag(v: str) -> bool:
    """Form booleans arrive as text. (FastAPI treats an absent bool field as False, which would silently switch features off.)"""
    return str(v).strip().lower() not in ("0", "false", "no", "off", "")


def deck_out(d: Deck, *, full: bool = True) -> dict:
    data = {
        "id": d.id, "document_id": d.document_id, "title": d.title, "subtitle": d.subtitle, "theme": d.theme,
        "status": d.status, "slide_count": len(d.slides or []), "meta": d.meta or {},
        "created_at": iso(d.created_at), "updated_at": iso(d.updated_at),
    }
    if full:
        data["slides"] = d.slides or []
    else:
        first = (d.slides or [{}])[0]
        data["cover"] = (first.get("image") or {}).get("seed") or d.title
    return data


def _launch(db, user, deck: Deck, title: str, load_sections, opts: deck_svc.DeckOptions, source: str) -> dict:
    """Queue the background job that fills `deck` from `load_sections()` → (title, [(i, title, text)])."""
    job = jobs.create_job(db, user.id, "deck", f"Presentation “{title}”", ref_id=deck.id)

    def run(ctx: jobs.JobContext) -> dict:
        with SessionLocal() as s:
            d = s.get(Deck, deck.id)
            try:
                ctx.update("Reading the document", 12)
                doc_title, sections = load_sections()
                words = sum(len(t.split()) for _, _, t in sections)
                ctx.update("Designing slides, diagrams and charts", 35)
                built = deck_svc.build(doc_title, sections, opts)
                ctx.update("Finishing touches", 90)
                d.title, d.subtitle, d.slides, d.status = built["title"], built["subtitle"], built["slides"], "ready"
                d.meta = {"engine": built["engine"], "source": source, "sections": len(sections), "words": words,
                          "style": opts.style, "generated_at": datetime.now(timezone.utc).isoformat()}
                s.commit()
                return {"deck_id": d.id, "slides": len(built["slides"]), "engine": built["engine"]}
            except Exception as exc:  # noqa: BLE001
                s.rollback()
                d = s.get(Deck, deck.id)
                if d:
                    d.status, d.meta = "failed", {"error": str(exc)[:300]}
                    s.commit()
                raise

    jobs.submit(job.id, run)
    return {"deck": deck_out(deck, full=False), "job_id": job.id}


@router.get("")
def list_decks(user: CurrentUser, db: DB):
    rows = db.scalars(select(Deck).where(Deck.owner_id == user.id).order_by(Deck.updated_at.desc())).all()
    return [deck_out(d, full=False) for d in rows]


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def create_from_document(body: DeckCreate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    if doc.status != "ready":
        raise HTTPException(status_code=409, detail="The document is still processing")
    deck = Deck(owner_id=user.id, document_id=doc.id, title=doc.title, theme=body.theme, status="processing", slides=[], meta={})
    db.add(deck)
    db.commit()
    wanted = body.chapter_indexes
    doc_id = doc.id

    def load():
        with SessionLocal() as s:
            d = s.get(Document, doc_id)
            return d.title, [(c.position, c.title, c.content) for c in d.chapters if wanted is None or c.position in wanted]

    opts = deck_svc.DeckOptions(slides=body.slides, style=body.style, theme=body.theme, images=body.images,
                                visuals=body.visuals, notes=body.notes, focus=body.focus)
    return _launch(db, user, deck, doc.title, load, opts, "library")


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def create_from_upload(
    user: CurrentUser, db: DB, file: UploadFile = File(...), slides: int = Form(12), style: DeckStyle = Form("executive"),
    theme: DeckTheme = Form("aurora"), images: str = Form("true"), visuals: str = Form("true"), notes: str = Form("true"), focus: str = Form(""),
):
    """Any readable file (TXT, MD, DOCX, PDF, XML, HTML, EPUB, PPTX, …) straight to a deck, without adding it to the library."""
    name = file.filename or "document.txt"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "txt"
    if ext not in extraction.SUPPORTED_FORMATS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type .{ext}. Try: {', '.join(sorted(extraction.SUPPORTED_FORMATS))}")
    data = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Files up to {MAX_UPLOAD_MB} MB can be turned into a presentation directly. Add larger ones to your library, then pick them there.")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    title = re.sub(r"[_\-]+", " ", name.rsplit(".", 1)[0]).strip().title() or "Untitled presentation"
    deck = Deck(owner_id=user.id, document_id=None, title=title, theme=theme, status="processing", slides=[], meta={})
    db.add(deck)
    db.commit()

    def load():
        try:
            doc = extraction.extract(name, data)
        except extraction.ExtractionError as exc:
            raise ValueError(str(exc)) from exc
        return title, [(i, c.title, c.content) for i, c in enumerate(doc.chapters)]

    opts = deck_svc.DeckOptions(slides=slides, style=style, theme=theme, images=_flag(images), visuals=_flag(visuals), notes=_flag(notes), focus=focus)
    return _launch(db, user, deck, title, load, opts, f"upload:{ext}")


@router.get("/art/image")
def art_image(
    seed: str = Query(max_length=160), theme: str = "aurora", style: str = "",
    w: int = Query(960, ge=160, le=1920), h: int = Query(540, ge=90, le=1080),
):
    """Deterministic generated artwork for a slide. Public on purpose: it encodes nothing beyond the seed words."""
    return Response(art.render(seed, theme, style, w, h), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400, immutable"})


@router.get("/{deck_id}")
def get_deck(deck_id: str, user: CurrentUser, db: DB):
    return deck_out(get_owned(db, Deck, user, deck_id, "Presentation"))


@router.patch("/{deck_id}")
def update_deck(deck_id: str, body: DeckUpdate, user: CurrentUser, db: DB):
    deck = get_owned(db, Deck, user, deck_id, "Presentation")
    if body.title is not None:
        deck.title = body.title
    if body.theme is not None:
        deck.theme = body.theme
    if body.slides is not None:
        cleaned = deck_svc.clean_slides(body.slides)
        if not cleaned:
            raise HTTPException(status_code=422, detail="A presentation needs at least one slide")
        deck.slides = cleaned
    db.commit()
    db.refresh(deck)
    return deck_out(deck)


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deck(deck_id: str, user: CurrentUser, db: DB):
    db.delete(get_owned(db, Deck, user, deck_id, "Presentation"))
    db.commit()


@router.get("/{deck_id}/export.pptx")
def export_pptx(deck_id: str, user: CurrentUser, db: DB):
    deck = get_owned(db, Deck, user, deck_id, "Presentation")
    if deck.status != "ready" or not deck.slides:
        raise HTTPException(status_code=409, detail="This presentation isn't ready yet")
    data = pptx_export.build_pptx(deck.title, deck.theme, deck.slides)
    fname = re.sub(r"[^A-Za-z0-9._ -]+", "", deck.title).strip()[:80] or "presentation"
    return Response(
        data, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{fname}.pptx"'},
    )
