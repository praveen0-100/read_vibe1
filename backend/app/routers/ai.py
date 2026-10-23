"""AI content intelligence endpoints."""
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from ..deps import DB, CurrentUser, get_owned_document
from ..models import Highlight
from ..schemas import ChatIn, CompareIn, DefineIn, DiagramIn, ExplainIn, MindMapIn, OverviewIn, QuizIn, SummarizeIn, TranslateIn, VisualIn
from ..services import ai, languages, llm, nlp, overview, translate

log = logging.getLogger("readvibe.ai")
router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
def ai_status(_: CurrentUser):
    return {"provider": llm.provider_name(), "llm": llm.available()}


@router.post("/summarize")
def summarize(body: SummarizeIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.summarize(doc, body.chapter_index, body.depth)


@router.post("/explain")
def explain(body: ExplainIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id) if body.document_id else None
    return ai.explain(body.text, body.mode, doc)


@router.post("/define")
def define(body: DefineIn, user: CurrentUser, db: DB):
    """Dictionary definition (Free Dictionary API) plus how the document itself uses the term."""
    doc = get_owned_document(db, user, body.document_id) if body.document_id else None
    term = body.term.strip().strip(".,;:!?\"'“”")
    dictionary: list[dict] = []
    phonetic = None
    audio = None
    if len(term.split()) <= 3:
        try:
            r = httpx.get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{term}", timeout=5)
            if r.status_code == 200:
                entry = r.json()[0]
                phonetic = entry.get("phonetic")
                audio = next((p.get("audio") for p in entry.get("phonetics", []) if p.get("audio")), None)
                for meaning in entry.get("meanings", [])[:3]:
                    for d in meaning.get("definitions", [])[:2]:
                        dictionary.append({"part_of_speech": meaning.get("partOfSpeech"), "definition": d.get("definition"), "example": d.get("example")})
        except (httpx.HTTPError, ValueError, IndexError, KeyError) as exc:
            log.info("dictionary lookup failed: %s", exc)
    return {
        "term": term,
        "phonetic": phonetic,
        "audio": audio,
        "dictionary": dictionary,
        "in_document": ai.define_in_document(term, doc),
    }


@router.post("/chat")
def chat(body: ChatIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.chat(doc, body.chapter_index, body.question, [t.model_dump() for t in body.history], body.selection)


@router.post("/mindmap")
def mindmap(body: MindMapIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.mind_map(doc, body.chapter_index)


@router.post("/diagram")
def diagram(body: DiagramIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.diagram(doc, body.chapter_index, body.kind, body.layout, body.detail, body.text)


@router.post("/quiz")
def quiz(body: QuizIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.quiz(doc, body.chapter_index, body.count)


class GradeIn(BaseModel):
    answer: str
    reference: str


@router.post("/quiz/grade")
def grade(body: GradeIn, _: CurrentUser):
    return nlp.grade_short_answer(body.answer, body.reference)


@router.post("/compare")
def compare(body: CompareIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    return ai.compare(doc, body.chapter_index, body.concept_a, body.concept_b)


@router.post("/visual")
def visual_references(body: VisualIn, _: CurrentUser):
    """Contextual reference images from Wikipedia / Wikimedia Commons (open-licensed)."""
    results = []
    headers = {"User-Agent": "ReadVibe/3.0 (educational reading app)"}
    try:
        with httpx.Client(timeout=6, headers=headers) as client:
            r = client.get("https://en.wikipedia.org/w/api.php", params={
                "action": "query", "format": "json", "generator": "search", "gsrsearch": body.query, "gsrlimit": 8,
                "prop": "pageimages|extracts|info", "piprop": "thumbnail", "pithumbsize": 640, "exintro": 1,
                "explaintext": 1, "exsentences": 2, "inprop": "url",
            })
            r.raise_for_status()
            pages = sorted((r.json().get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
            for p in pages:
                thumb = (p.get("thumbnail") or {}).get("source")
                results.append({
                    "title": p.get("title"),
                    "image": thumb,
                    "summary": p.get("extract"),
                    "url": p.get("fullurl"),
                    "source": "Wikipedia",
                })
            if sum(1 for x in results if x["image"]) < 3:
                c = client.get("https://commons.wikimedia.org/w/api.php", params={
                    "action": "query", "format": "json", "generator": "search", "gsrsearch": f"filetype:bitmap {body.query}",
                    "gsrnamespace": 6, "gsrlimit": 6, "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 640,
                })
                for p in ((c.json().get("query") or {}).get("pages") or {}).values():
                    info = (p.get("imageinfo") or [{}])[0]
                    if info.get("thumburl"):
                        results.append({
                            "title": p.get("title", "").removeprefix("File:").rsplit(".", 1)[0],
                            "image": info["thumburl"], "summary": None,
                            "url": info.get("descriptionurl"), "source": "Wikimedia Commons",
                        })
    except httpx.HTTPError as exc:
        log.info("visual lookup failed: %s", exc)
        return {"query": body.query, "results": [], "error": "Image sources are unreachable right now. Check your connection and try again."}
    with_images = [r for r in results if r["image"]]
    return {"query": body.query, "results": (with_images + [r for r in results if not r["image"]])[:9]}


@router.get("/recommendations")
def recommendations(user: CurrentUser, db: DB):
    from ..models import Document

    docs = db.scalars(
        select(Document).where(Document.owner_id == user.id, Document.status == "ready")
        .order_by(Document.last_opened_at.desc().nulls_last()).limit(3)
    ).all()
    counts = dict(db.execute(
        select(Highlight.document_id, func.count()).where(Highlight.owner_id == user.id).group_by(Highlight.document_id)
    ).all())
    recs = []
    for d in docs:
        recs.extend(ai.recommendations(d, counts.get(d.id, 0)))
    seen, unique = set(), []
    for r in recs:
        key = (r["action"], r["document_id"])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique[:6]


@router.post("/overview")
def audio_overview(body: OverviewIn, user: CurrentUser, db: DB):
    """A spoken overview written natively in the requested language (Tamil, Telugu, Malayalam, Kannada, Hindi …)."""
    doc = get_owned_document(db, user, body.document_id)
    try:
        return overview.generate(doc, body.chapter_index, body.language, body.format)
    except overview.OverviewError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/translate")
def translate_texts(body: TranslateIn, _: CurrentUser):
    """Translate passages (a chapter's paragraphs, a transcript) into any supported language. Untranslatable items are null."""
    if sum(len(t) for t in body.texts) > 24000:
        raise HTTPException(status_code=413, detail="Send smaller batches")
    target, source = languages.get(body.target).code, languages.get(body.source).code
    texts, engine, note = translate.translate_texts(body.texts, target, source)
    return {"language": target, "translations": texts, "engine": engine, "note": note}
