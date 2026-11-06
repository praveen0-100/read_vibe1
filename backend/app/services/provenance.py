"""Source provenance: where a passage lives in the original (chapter, paragraph, PDF page) and whether a claim is supported by it.

Generated content (overviews, drafts, answers) must always be traceable to original passages and distinguishable from them,
so this module is the single place that maps text to source locations and grades claims against sources.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..models import Document
from . import nlp

# Share of a claim's content words that the best passage must contain. Deliberately conservative: this is lexical
# evidence, not proof, and the UI labels it as such.
SUPPORTED_COVERAGE = 0.6
PARTIAL_COVERAGE = 0.35


def _alnum(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def assign_pages(chapters, pages: list[str]) -> None:
    """Annotate extracted chapters with the PDF page (1-based) of every paragraph, in reading order.

    Page text is matched by each paragraph's opening characters, searching forward only, so a paragraph that cannot be
    matched (hyphenation, figures) inherits the previous page instead of jumping backwards.
    """
    normalized = [_alnum(p) for p in pages]
    cur = 0
    for ch in chapters:
        mapped: list[int] = []
        for para in nlp.paragraphs(ch.content):
            key = _alnum(para)[:48]
            if len(key) >= 14:
                for p in range(cur, min(len(normalized), cur + 40)):
                    if key in normalized[p]:
                        cur = p
                        break
            mapped.append(cur + 1)
        if mapped:
            ch.page_start, ch.page_end, ch.paragraph_pages = mapped[0], mapped[-1], mapped


@dataclass
class Hit:
    document_id: str
    document_title: str
    chapter_index: int
    chapter_title: str
    paragraph_index: int
    page: int | None
    text: str
    score: float
    coverage: float


def locator(doc: Document, chapter_index: int, paragraph_index: int) -> dict:
    """A stable SourceLocator for one paragraph. Pages are only present when the source has them (PDF)."""
    ch = next((c for c in doc.chapters if c.position == chapter_index), None)
    loc = {"source_id": doc.id, "chapter_index": chapter_index, "paragraph_index": paragraph_index,
           "chapter_title": ch.title if ch else None, "page": None}
    if ch and ch.paragraph_pages and 0 <= paragraph_index < len(ch.paragraph_pages):
        loc["page"] = ch.paragraph_pages[paragraph_index]
    return loc


def _paragraph_units(doc: Document) -> list[tuple[int, int, str, str]]:
    """(chapter_index, paragraph_index, chapter_title, text) for every paragraph of a document."""
    units = []
    for ch in doc.chapters:
        for pi, para in enumerate(nlp.paragraphs(ch.content)):
            if len(para.split()) >= 4:
                units.append((ch.position, pi, ch.title, para))
    return units


def numbers_in(text: str) -> set[str]:
    """Figures mentioned in a passage (used to notice sources that give different numbers)."""
    return set(re.findall(r"\d+(?:[.,]\d+)?%?", text))


def _coverage(claim: str, passage: str) -> float:
    q = {nlp.stem(w) for w in nlp.content_words(claim)}
    if not q:
        return 0.0
    p = {nlp.stem(w) for w in nlp.content_words(passage)}
    return len(q & p) / len(q)


def retrieve(docs: list[Document], query: str, k: int = 4) -> list[Hit]:
    """Top paragraphs across the given documents for a query, each with its locator."""
    entries: list[tuple[Document, int, int, str, str]] = []
    for d in docs:
        for ci, pi, title, text in _paragraph_units(d):
            entries.append((d, ci, pi, title, text))
    if not entries:
        return []
    # the passage's chapter_index carries the entry number so a hit maps straight back to its document and paragraph
    index = nlp.BM25Index([nlp.Passage(text=e[4], chapter_index=i, chapter_title=e[3]) for i, e in enumerate(entries)])
    hits = []
    for score, passage in index.search(query, k):
        d, ci, pi, title, text = entries[passage.chapter_index]
        loc = locator(d, ci, pi)
        hits.append(Hit(d.id, d.title, ci, title, pi, loc["page"], text, round(score, 3), round(_coverage(query, text), 2)))
    return hits


def verify_claim(docs: list[Document], claim: str, k: int = 3) -> dict:
    """Grade a statement against the sources (supported / partial / unsupported) and return the evidence with locators."""
    hits = retrieve(docs, claim, k)
    best = max((h.coverage for h in hits), default=0.0)
    verdict = "supported" if best >= SUPPORTED_COVERAGE else "partial" if best >= PARTIAL_COVERAGE else "unsupported"
    return {
        "claim": claim,
        "verdict": verdict,
        "confidence": round(best, 2),
        "evidence": [h.__dict__ for h in hits if h.coverage >= PARTIAL_COVERAGE / 2],
    }


def ground_turns(doc: Document, turns: list[dict]) -> dict:
    """Attach source_refs to each script turn and summarise how much of the script the document supports.
    Questions and short sign-offs carry no claims, so only statement-like turns count toward the score."""
    claim_turns = 0
    grounded = 0
    for t in turns:
        text = t.get("text", "")
        t["source_refs"] = []
        if text.rstrip().endswith("?") or len(text.split()) < 6:
            continue
        claim_turns += 1
        res = verify_claim([doc], text, k=1)
        if res["verdict"] != "unsupported" and res["evidence"]:
            ev = res["evidence"][0]
            t["source_refs"] = [{"source_id": ev["document_id"], "chapter_index": ev["chapter_index"], "paragraph_index": ev["paragraph_index"],
                                 "page": ev["page"], "chapter_title": ev["chapter_title"], "confidence": res["confidence"]}]
            grounded += 1
    return {"claim_turns": claim_turns, "grounded_turns": grounded,
            "score": round(grounded / claim_turns, 2) if claim_turns else None}
