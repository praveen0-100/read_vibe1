"""Reading sessions, statistics dashboard, global search and background-job notifications."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select, update

from ..deps import DB, CurrentUser, get_owned
from ..models import Audiobook, Chapter, Document, Highlight, Job, Note, ReadingSession, ResearchProject
from ..schemas import SessionCreate
from ..serializers import job_out

router = APIRouter(tags=["activity"])


@router.post("/sessions", status_code=201)
def log_session(body: SessionCreate, user: CurrentUser, db: DB):
    started = datetime.now(timezone.utc) - timedelta(seconds=body.seconds)
    s = ReadingSession(owner_id=user.id, document_id=body.document_id, kind=body.kind, mode=body.mode, seconds=body.seconds, started_at=started)
    db.add(s)
    db.commit()
    return {"id": s.id}


def _as_date(dt: datetime, tz_offset: int) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt - timedelta(minutes=tz_offset)).date()


@router.get("/stats")
def stats(user: CurrentUser, db: DB, tz_offset: int = Query(0, description="Client Date.getTimezoneOffset()")):
    since = datetime.now(timezone.utc) - timedelta(days=60)
    sessions = db.scalars(select(ReadingSession).where(ReadingSession.owner_id == user.id, ReadingSession.started_at >= since)).all()
    today = _as_date(datetime.now(timezone.utc), tz_offset)
    week_start = today - timedelta(days=today.weekday())

    per_day: dict[date, int] = {}
    for s in sessions:
        if s.kind == "reading" or s.kind == "focus":
            d = _as_date(s.started_at, tz_offset)
            per_day[d] = per_day.get(d, 0) + s.seconds

    week = []
    for i in range(7):
        d = week_start + timedelta(days=i)
        week.append({"date": d.isoformat(), "label": d.strftime("%a")[0], "minutes": round(per_day.get(d, 0) / 60), "today": d == today})

    streak = 0
    cursor = today if per_day.get(today) else today - timedelta(days=1)
    while per_day.get(cursor):
        streak += 1
        cursor -= timedelta(days=1)

    docs = db.scalars(select(Document).where(Document.owner_id == user.id)).all()
    listening = sum(s.seconds for s in sessions if s.kind == "listening")
    listening += db.scalar(select(func.coalesce(func.sum(Audiobook.listened_seconds), 0)).where(Audiobook.owner_id == user.id)) or 0
    modes: dict[str, int] = {}
    for s in sessions:
        if s.kind == "reading":
            modes[s.mode] = modes.get(s.mode, 0) + s.seconds
    return {
        "week": week,
        "week_minutes": sum(w["minutes"] for w in week),
        "today_minutes": round(per_day.get(today, 0) / 60),
        "streak": streak,
        "books_completed": sum(1 for d in docs if d.progress >= 98),
        "documents": len(docs),
        "audio_hours": round(listening / 3600, 1),
        "focus_sessions": sum(1 for s in sessions if s.kind == "focus"),
        "highlights": db.scalar(select(func.count()).select_from(Highlight).where(Highlight.owner_id == user.id)),
        "notes": db.scalar(select(func.count()).select_from(Note).where(Note.owner_id == user.id)),
        "mode_minutes": {k: round(v / 60) for k, v in modes.items()},
    }


@router.get("/search")
def global_search(user: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=200)):
    like = f"%{q.lower()}%"
    docs = db.scalars(select(Document).where(
        Document.owner_id == user.id,
        or_(func.lower(Document.title).like(like), func.lower(Document.author).like(like), func.lower(Document.description).like(like)),
    ).limit(8)).all()
    passages = db.execute(
        select(Chapter.document_id, Chapter.position, Chapter.title, Chapter.content, Document.title)
        .join(Document, Document.id == Chapter.document_id)
        .where(Document.owner_id == user.id, func.lower(Chapter.content).like(like)).limit(8)
    ).all()
    notes = db.scalars(select(Note).where(
        Note.owner_id == user.id, or_(func.lower(Note.title).like(like), func.lower(Note.content).like(like), func.lower(Note.quote).like(like))
    ).limit(8)).all()
    highlights = db.scalars(select(Highlight).where(Highlight.owner_id == user.id, func.lower(Highlight.text).like(like)).limit(8)).all()
    projects = db.scalars(select(ResearchProject).where(
        ResearchProject.owner_id == user.id, or_(func.lower(ResearchProject.title).like(like), func.lower(ResearchProject.topic).like(like))
    ).limit(5)).all()

    def snippet(text: str) -> str:
        i = text.lower().find(q.lower())
        start = max(0, i - 60)
        return ("…" if start else "") + text[start : i + len(q) + 80].replace("\n", " ") + "…"

    return {
        "documents": [{"id": d.id, "title": d.title, "author": d.author, "type": d.doc_type, "color": d.color, "progress": d.progress} for d in docs],
        "passages": [{"document_id": p[0], "chapter_index": p[1], "chapter_title": p[2], "snippet": snippet(p[3]), "document_title": p[4]} for p in passages],
        "notes": [{"id": n.id, "title": n.title, "category": n.category, "snippet": (n.content or "")[:120]} for n in notes],
        "highlights": [{"id": h.id, "document_id": h.document_id, "chapter_index": h.chapter_index, "text": h.text, "category": h.category} for h in highlights],
        "projects": [{"id": p.id, "title": p.title, "status": p.status} for p in projects],
    }


@router.get("/jobs")
def list_jobs(user: CurrentUser, db: DB, active: bool = False, limit: int = 20):
    stmt = select(Job).where(Job.owner_id == user.id)
    if active:
        stmt = stmt.where(Job.status.in_(["queued", "processing"]))
    return [job_out(j) for j in db.scalars(stmt.order_by(Job.created_at.desc()).limit(limit))]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user: CurrentUser, db: DB):
    return job_out(get_owned(db, Job, user, job_id, "Job"))


@router.post("/jobs/mark-seen", status_code=204)
def mark_jobs_seen(user: CurrentUser, db: DB):
    db.execute(update(Job).where(Job.owner_id == user.id, Job.status.in_(["completed", "failed"])).values(seen=True))
    db.commit()


@router.delete("/jobs", status_code=204)
def clear_jobs(user: CurrentUser, db: DB):
    for j in db.scalars(select(Job).where(Job.owner_id == user.id, Job.status.in_(["completed", "failed"]))):
        db.delete(j)
    db.commit()
