"""Study: spaced-repetition flashcards (SM-2) built from highlights, documents or by hand."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Card, Highlight, ReviewLog, aware, utcnow
from ..serializers import iso
from ..services import nlp, srs

router = APIRouter(prefix="/study", tags=["study"])


class CardIn(BaseModel):
    front: str = Field(min_length=1, max_length=2000)
    back: str = Field(min_length=1, max_length=4000)
    document_id: str | None = None


class FromDocIn(BaseModel):
    document_id: str
    count: int = Field(default=10, ge=1, le=40)


class ReviewIn(BaseModel):
    grade: Literal["again", "hard", "good", "easy"]


class CardPatch(BaseModel):
    suspended: bool | None = None
    front: str | None = Field(default=None, min_length=1, max_length=2000)
    back: str | None = Field(default=None, min_length=1, max_length=4000)


def card_out(c: Card) -> dict:
    return {"id": c.id, "document_id": c.document_id, "front": c.front, "back": c.back, "source": c.source or {},
            "ease": c.ease, "interval_days": c.interval_days, "reps": c.reps, "lapses": c.lapses, "due_at": iso(c.due_at),
            "suspended": c.suspended, "mature": c.interval_days >= srs.MATURE_DAYS}


def _existing_sources(db, user_id: str, key: str) -> set:
    return {(c.source or {}).get(key) for c in db.scalars(select(Card).where(Card.owner_id == user_id)) if (c.source or {}).get(key)}


@router.post("/cards", status_code=201)
def create_card(body: CardIn, user: CurrentUser, db: DB):
    if body.document_id:
        get_owned_document(db, user, body.document_id)
    c = Card(owner_id=user.id, document_id=body.document_id, front=body.front.strip(), back=body.back.strip(), source={"manual": True})
    db.add(c)
    db.commit()
    return card_out(c)


@router.post("/from-highlights", status_code=201)
def from_highlights(body: FromDocIn, user: CurrentUser, db: DB):
    """One card per highlight (not already carded): the passage with its key term blanked out, answer = the term."""
    doc = get_owned_document(db, user, body.document_id)
    done = _existing_sources(db, user.id, "highlight_id")
    text = " ".join(c.content for c in doc.chapters)
    phrases = nlp.key_phrases(text, 30)
    made = []
    for h in db.scalars(select(Highlight).where(Highlight.document_id == doc.id, Highlight.owner_id == user.id).order_by(Highlight.created_at)):
        if h.id in done or len(made) >= body.count:
            continue
        passage = " ".join(h.text.split())
        hit = srs.cloze(passage, phrases)
        front, back = (hit[0], hit[1]) if hit else (f"Recall this passage from “{doc.title}”", passage)
        c = Card(owner_id=user.id, document_id=doc.id, front=front, back=back, source={"highlight_id": h.id, "chapter_index": h.chapter_index})
        db.add(c)
        made.append(c)
    db.commit()
    return {"created": len(made), "cards": [card_out(c) for c in made]}


@router.post("/from-document", status_code=201)
def from_document(body: FromDocIn, user: CurrentUser, db: DB):
    """Term → definition cards drawn from the document's own text."""
    doc = get_owned_document(db, user, body.document_id)
    have = {c.front.lower() for c in db.scalars(select(Card).where(Card.owner_id == user.id, Card.document_id == doc.id))}
    cards = [c for c in nlp.flashcards(" ".join(ch.content for ch in doc.chapters), limit=body.count * 2) if c["front"].lower() not in have][: body.count]
    made = [Card(owner_id=user.id, document_id=doc.id, front=c["front"], back=c["back"], source={"generated": True}) for c in cards]
    db.add_all(made)
    db.commit()
    return {"created": len(made), "cards": [card_out(c) for c in made]}


@router.get("/queue")
def queue(user: CurrentUser, db: DB, limit: int = Query(default=20, ge=1, le=100), document_id: str | None = None):
    now = utcnow()
    stmt = select(Card).where(Card.owner_id == user.id, Card.suspended.is_(False), Card.due_at <= now)
    if document_id:
        stmt = stmt.where(Card.document_id == document_id)
    due_total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    cards = db.scalars(stmt.order_by(Card.due_at).limit(limit)).all()
    return {"due": due_total, "cards": [card_out(c) for c in cards]}


@router.post("/cards/{card_id}/review")
def review(card_id: str, body: ReviewIn, user: CurrentUser, db: DB):
    c = get_owned(db, Card, user, card_id, "Card")
    now = utcnow()
    nxt, due = srs.schedule(srs.State(c.ease, c.interval_days, c.reps, c.lapses), body.grade, now)
    c.ease, c.interval_days, c.reps, c.lapses, c.due_at, c.last_reviewed_at = nxt.ease, nxt.interval_days, nxt.reps, nxt.lapses, due, now
    db.add(ReviewLog(owner_id=user.id, card_id=c.id, grade=body.grade, at=now))
    db.commit()
    return card_out(c)


@router.patch("/cards/{card_id}")
def update_card(card_id: str, body: CardPatch, user: CurrentUser, db: DB):
    c = get_owned(db, Card, user, card_id, "Card")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return card_out(c)


@router.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: str, user: CurrentUser, db: DB):
    db.delete(get_owned(db, Card, user, card_id, "Card"))
    db.commit()


@router.get("/stats")
def stats(user: CurrentUser, db: DB):
    now = utcnow()
    cards = db.scalars(select(Card).where(Card.owner_id == user.id)).all()
    active = [c for c in cards if not c.suspended]
    logs = db.scalars(select(ReviewLog).where(ReviewLog.owner_id == user.id, ReviewLog.at >= now - timedelta(days=60))).all()
    days = {aware(l.at).date() for l in logs}
    streak, day = 0, now.date()
    if day not in days:  # a streak is still alive until the day is over
        day -= timedelta(days=1)
    while day in days:
        streak += 1
        day -= timedelta(days=1)
    recent = [l for l in logs if aware(l.at) >= now - timedelta(days=30)]
    return {
        "total": len(cards), "due": sum(1 for c in active if aware(c.due_at) <= now), "new": sum(1 for c in active if c.reps == 0 and c.last_reviewed_at is None),
        "mature": sum(1 for c in active if c.interval_days >= srs.MATURE_DAYS), "reviewed_today": sum(1 for l in logs if aware(l.at).date() == now.date()),
        "streak_days": streak, "retention_30d": round(sum(1 for l in recent if l.grade != "again") / len(recent), 2) if recent else None,
    }
