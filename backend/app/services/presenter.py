"""Presenter Q&A: answer an audience question about the slide on screen, using the slide and the deck's source document.

The answer always carries the passages it came from (with chapter/paragraph/page) so a presenter can show where a claim
lives, and it says plainly when the source does not cover the question instead of improvising.
"""
from __future__ import annotations

from ..models import Deck, Document
from . import languages, llm, nlp, provenance

MIN_COVERAGE = 0.25  # below this the source does not really address the question


def slide_text(slide: dict) -> str:
    parts = [slide.get("title", ""), slide.get("subtitle", ""), *slide.get("bullets", []), slide.get("main_point", ""), slide.get("notes", "")]
    data = slide.get("data") or {}
    parts.append(str(data.get("text", "")))
    return " ".join(p for p in parts if p).strip()


def answer(deck: Deck, doc: Document | None, slide_index: int | None, question: str, language: str | None = None) -> dict:
    slides = deck.slides or []
    slide = slides[slide_index] if slide_index is not None and 0 <= slide_index < len(slides) else None
    context = slide_text(slide) if slide else ""
    query = f"{question} {slide.get('title', '') if slide else ''}"
    hits = provenance.retrieve([doc], query, k=3) if doc else []
    grounded = [h for h in hits if provenance._coverage(question, h.text) >= MIN_COVERAGE or (slide and provenance._coverage(question, context) >= MIN_COVERAGE)]
    citations = [{"source_id": h.document_id, "chapter_index": h.chapter_index, "chapter_title": h.chapter_title,
                  "paragraph_index": h.paragraph_index, "page": h.page, "snippet": h.text[:260]} for h in (grounded or hits)[:3]]

    lang = languages.BY_CODE.get((language or "").lower())
    engine = "local"
    if llm.available() and (grounded or context):
        excerpts = "\n\n".join(f"<excerpt chapter=\"{h.chapter_title}\">\n{h.text}\n</excerpt>" for h in grounded)
        prompt = (
            f"You are presenting “{deck.title}”. The slide on screen says: {context or '(no slide selected)'}\n\n"
            f"Source excerpts:\n{excerpts or '(none relevant)'}\n\nAudience question: {question}\n\n"
            "Answer briefly, as a presenter would speak, using only the slide and the excerpts. If they do not cover the question, say so."
            + (f" Reply in {lang.name} ({lang.native})." if lang else "")
        )
        try:
            return {"answer": llm.complete_text(llm.READER_SYSTEM, [{"role": "user", "content": prompt}], max_tokens=900),
                    "citations": citations, "grounded": bool(grounded), "engine": llm.provider_name(), "slide_index": slide_index}
        except llm.LLMUnavailable:
            pass

    if grounded:
        pool = " ".join(h.text for h in grounded)
        text = " ".join(nlp.top_sentences(pool, 2, query=question)) or grounded[0].text[:300]
    elif context and provenance._coverage(question, context) >= MIN_COVERAGE:
        text = " ".join(nlp.top_sentences(context, 2, query=question)) or context[:300]
    else:
        text = "The source for this presentation doesn’t cover that. It’s worth noting as a follow-up rather than guessing."
    note = f" (Answer shown in English; the free engine can’t reply in {lang.name}.)" if lang and lang.code != "en" else ""
    return {"answer": text + note, "citations": citations if grounded else [], "grounded": bool(grounded), "engine": engine, "slide_index": slide_index}
