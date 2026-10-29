"""Library categorisation and recommendations.

Every document is placed in a category from its title, tags, description and author. Reading behaviour (progress, favourites,
pins, recent opens) turns categories into an interest profile. From that profile we
  * rank the user's interests (each carries a Project Gutenberg `topic` the client uses to suggest new books), and
  * find unfinished books in the library that are related to what the user already engages with, saying *why*.
Everything is computed locally from the user's own data — no AI key needed.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from . import languages

# (id, label, Gutenberg topic, keywords). Keywords match whole words, lower-cased.
CATEGORIES: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    ("fiction", "Novels & fiction", "fiction", frozenset("novel fiction story stories tale tales romance narrative short".split())),
    ("mystery", "Mystery & crime", "detective", frozenset("mystery detective crime murder clew thriller case police spy".split())),
    ("adventure", "Adventure", "adventure", frozenset("adventure voyage journey island treasure expedition travel quest sea".split())),
    ("scifi", "Sci-Fi & fantasy", "science fiction", frozenset("science-fiction scifi fantasy future robot space alien magic dragon".split())),
    ("romance", "Romance", "love", frozenset("love romance marriage heart courtship passion".split())),
    ("children", "Story books", "children", frozenset("children fairy tales kids nursery fables fable".split())),
    ("poetry", "Poetry & drama", "poetry", frozenset("poetry poems poem verse sonnets drama play plays tragedy comedy salesman".split())),
    ("philosophy", "Philosophy", "philosophy", frozenset("philosophy ethics logic metaphysics mind moral stoic reason wisdom".split())),
    ("history", "History & society", "history", frozenset("history war empire revolution ancient civilization biography politics policy society".split())),
    ("science", "Science & nature", "science", frozenset("science physics biology chemistry nature evolution mathematics astronomy research study".split())),
    ("tech", "Technology & design", "technology", frozenset("design ux ui software programming code cyber security computer data internet digital usage engineering".split())),
    ("psychology", "Mind & psychology", "psychology", frozenset("psychology mind behavior behaviour emotion habit learning memory".split())),
    ("business", "Business & economics", "economics", frozenset("economics business finance market management money trade leadership".split())),
)
BY_ID = {c[0]: c for c in CATEGORIES}
GENERAL = ("general", "Everything else", "")

_STOP = frozenset("the and for with from that this have has was were are not but you your his her they them their into about over under "
                  "project gutenberg book books ebook pdf document chapter section part one two three".split())
_WORD = re.compile(r"\w+", re.U)


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 3 and w not in _STOP}


def _text(doc) -> str:
    return f"{doc.title} {' '.join(doc.tags or [])} {(doc.description or '')[:500]}"


def categorise(doc) -> tuple[str, str, str]:
    """(id, label, topic) of the best-matching category; a title/tag hit counts double a description hit."""
    head = set(_WORD.findall(f"{doc.title} {' '.join(doc.tags or [])}".lower()))
    body = set(_WORD.findall((doc.description or "")[:500].lower()))
    best, score = None, 0
    for cat in CATEGORIES:
        s = 2 * len(head & cat[3]) + len(body & cat[3])
        if s > score:
            best, score = cat, s
    return (best[0], best[1], best[2]) if best else GENERAL


def _engagement(doc, now: datetime) -> float:
    w = 1.0 + (doc.progress or 0) / 50          # a finished book counts 3×
    w += 2 if doc.favorite else 0
    w += 1 if doc.pinned else 0
    opened = doc.last_opened_at
    if opened:
        if opened.tzinfo is None:
            opened = opened.replace(tzinfo=timezone.utc)
        if now - opened < timedelta(days=14):
            w += 1
    return w


def _similarity(a_tokens: set[str], b_tokens: set[str], same_category: bool) -> float:
    union = a_tokens | b_tokens
    jac = len(a_tokens & b_tokens) / len(union) if union else 0.0
    return 0.6 * min(1.0, jac * 4) + (0.4 if same_category else 0.0)


def build(docs: list) -> dict:
    now = datetime.now(timezone.utc)
    ready = [d for d in docs if d.status == "ready"]
    cats: dict[str, dict] = {}
    placed: dict[str, tuple[str, str, str]] = {}
    for d in ready:
        cid, label, topic = categorise(d)
        placed[d.id] = (cid, label, topic)
        c = cats.setdefault(cid, {"id": cid, "label": label, "topic": topic, "doc_ids": [], "score": 0.0})
        c["doc_ids"].append(d.id)
        c["score"] += _engagement(d, now)
    # language groups: reading in Tamil/Telugu/… is its own interest, shown beside the topical categories
    for d in ready:
        lang = languages.detect(f"{d.title} {(d.description or '')[:300]}")
        if lang != "en":
            meta = languages.get(lang)
            c = cats.setdefault(f"lang-{lang}", {"id": f"lang-{lang}", "label": f"{meta.name} · {meta.native}", "topic": "", "doc_ids": [], "score": 0.0})
            c["doc_ids"].append(d.id)

    categories = sorted(cats.values(), key=lambda c: (c["id"] == "general", c["id"].startswith("lang-"), -c["score"], c["label"]))
    interests = [{"id": c["id"], "label": c["label"], "topic": c["topic"], "score": round(c["score"], 2)}
                 for c in categories if c["topic"]]

    # anchors: books the user has actually engaged with
    anchors = [d for d in ready if (d.progress or 0) > 0 or d.favorite or d.pinned or d.last_opened_at]
    toks = {d.id: _tokens(_text(d)) for d in ready}
    anchor_ids = {a.id for a in anchors}
    related = []
    for d in ready:
        if d.id in anchor_ids and (d.progress or 0) >= 95:
            continue                                  # already finished
        best = None
        for a in anchors:
            if a.id == d.id:
                continue
            s = _similarity(toks[a.id], toks[d.id], placed[a.id][0] == placed[d.id][0] and placed[d.id][0] != "general") * _engagement(a, now) ** 0.5
            if best is None or s > best[0]:
                best = (s, a)
        if best and best[0] >= 0.5:
            shared = sorted((toks[best[1].id] & toks[d.id]) - _STOP)[:3]
            reason = f"Because you’re into {placed[d.id][1]}" if not shared and placed[best[1].id][0] == placed[d.id][0] else \
                f"Shares {', '.join(shared)} with “{best[1].title}”" if shared else f"Similar to “{best[1].title}”"
            related.append({"doc_id": d.id, "score": round(best[0], 3), "reason": reason, "because": {"doc_id": best[1].id, "title": best[1].title},
                            "category": placed[d.id][0]})
    related.sort(key=lambda r: -r["score"])
    return {"categories": categories, "interests": interests, "related": related[:12], "assignments": {k: v[0] for k, v in placed.items()}}
