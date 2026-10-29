"""The reader model: what the agent knows about how this person reads, learns and is doing — computed from their own data.

  behaviour   when and how long they read, consistency, trend, what is stalled
  cognition   estimated pace, quiz performance, how deep they engage, how much scaffolding helps
  wellbeing   late-night reading, very long sessions, recent mood check-ins
  memory      goals / preferences / struggles they told the agent (or it noted), all listed and deletable

Everything is derived from rows the app already stores plus a handful of `AgentEvent`s. The user can switch personalisation
off (nothing here is then used or written), see all of it in Settings, and delete it.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...models import AgentEvent, AgentMemory, Document, Highlight, Note, ReadingSession, User

WINDOW_DAYS = 60
MAX_MEMORIES = 60

DEFAULT_SETTINGS = {"personalize": True, "explain_level": "auto", "tone": "warm"}


def settings_for(user: User) -> dict:
    return {**DEFAULT_SETTINGS, **((user.preferences or {}).get("agent") or {})}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def local_now(tz_offset: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=tz_offset)


def _local(dt: datetime, tz_offset: int) -> datetime:
    return _aware(dt) - timedelta(minutes=tz_offset)


def _daypart(hour: int) -> str:
    return "early mornings" if 4 <= hour < 9 else "mornings" if hour < 12 else "afternoons" if hour < 17 else "evenings" if hour < 22 else "late at night"


def _hours_label(hours: list[int]) -> str:
    if not hours:
        return ""
    h = hours[0]
    return f"{(h % 12) or 12}{'am' if h < 12 else 'pm'}"


def build(db: Session, user: User, tz_offset: int = 0) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=WINDOW_DAYS)
    sessions = db.scalars(select(ReadingSession).where(ReadingSession.owner_id == user.id, ReadingSession.started_at >= since)).all()
    docs = db.scalars(select(Document).where(Document.owner_id == user.id, Document.status == "ready")).all()
    events = db.scalars(select(AgentEvent).where(AgentEvent.owner_id == user.id, AgentEvent.created_at >= since)
                        .order_by(AgentEvent.created_at.desc()).limit(400)).all()

    # ── behaviour ──────────────────────────────────────────────
    per_day: Counter = Counter()
    by_hour: Counter = Counter()
    modes: Counter = Counter()
    kinds: Counter = Counter()
    longest = 0
    late = 0
    for s in sessions:
        local = _local(s.started_at, tz_offset)
        kinds[s.kind] += s.seconds
        if s.kind in ("reading", "focus"):
            per_day[local.date()] += s.seconds
            by_hour[local.hour] += s.seconds
            longest = max(longest, s.seconds)
            if local.hour >= 23 or local.hour < 4:
                late += s.seconds
        if s.kind == "reading":
            modes[s.mode] += s.seconds
    today = local_now(tz_offset).date()
    streak, cursor = 0, today if per_day.get(today) else today - timedelta(days=1)
    while per_day.get(cursor):
        streak += 1
        cursor -= timedelta(days=1)
    recent14 = sum(v for d, v in per_day.items() if (today - d).days < 14)
    prior14 = sum(v for d, v in per_day.items() if 14 <= (today - d).days < 28)
    trend = "new" if not prior14 and not recent14 else "rising" if recent14 > prior14 * 1.25 else "falling" if recent14 < prior14 * 0.75 else "steady"
    active_30 = sum(1 for d in per_day if (today - d).days < 30)
    focus_total = sum(per_day.values())
    peak_hours = [h for h, _ in by_hour.most_common(2)] if focus_total >= 600 else []
    last_active = max(per_day) if per_day else None
    reading_sessions = [s for s in sessions if s.kind in ("reading", "focus") and s.seconds >= 30]

    in_progress = [d for d in docs if 1 <= (d.progress or 0) < 95]
    stalled = []
    for d in in_progress:
        opened = _aware(d.last_opened_at)
        idle = (now - opened).days if opened else None
        if idle is not None and idle >= 7:
            stalled.append({"id": d.id, "title": d.title, "progress": round(d.progress), "days_idle": idle})
    stalled.sort(key=lambda x: -x["progress"])

    behavior = {
        "minutes_30d": round(sum(v for d, v in per_day.items() if (today - d).days < 30) / 60),
        "active_days_30d": active_30,
        "consistency": round(active_30 / 30, 2),
        "sessions": len(reading_sessions),
        "avg_session_min": round(sum(s.seconds for s in reading_sessions) / len(reading_sessions) / 60) if reading_sessions else 0,
        "peak_hours": peak_hours,
        "peak_label": _daypart(peak_hours[0]) if peak_hours else None,
        "preferred_mode": modes.most_common(1)[0][0] if modes else None,
        "listening_share": round(kinds["listening"] / max(1, sum(kinds.values())), 2),
        "streak": streak,
        "days_since_active": (today - last_active).days if last_active else None,
        "trend": trend,
        "documents": len(docs),
        "in_progress": [{"id": d.id, "title": d.title, "progress": round(d.progress)} for d in sorted(in_progress, key=lambda d: _aware(d.last_opened_at) or now, reverse=True)[:5]],
        "finished": sum(1 for d in docs if (d.progress or 0) >= 95),
        "stalled": stalled[:3],
    }

    # ── cognition ──────────────────────────────────────────────
    quiz = [e for e in events if e.kind == "quiz" and (e.payload or {}).get("total")]
    scores = [min(1.0, (e.payload["score"] or 0) / e.payload["total"]) for e in quiz]
    weak: Counter = Counter()
    for e, sc in zip(quiz, scores):
        if sc < 0.6 and e.document_id:
            weak[e.document_id] += 1
    titles = {d.id: d.title for d in docs}
    reading_secs_by_doc: Counter = Counter(s.document_id for s in sessions if s.kind == "reading" and s.document_id)
    words = sum((d.word_count or 0) * (d.progress or 0) / 100 for d in docs if reading_secs_by_doc.get(d.id))
    minutes = sum(reading_secs_by_doc.values()) / 60
    pace = round(words / minutes) if minutes >= 20 and words >= 2000 else None
    pace = pace if pace and 100 <= pace <= 450 else None  # outside this the progress numbers, not the reader, are off
    hl = db.scalar(select(func.count()).select_from(Highlight).where(Highlight.owner_id == user.id, Highlight.created_at >= since)) or 0
    notes_n = db.scalar(select(func.count()).select_from(Note).where(Note.owner_id == user.id, Note.created_at >= since)) or 0
    hours = max(minutes / 60, 0.5)
    engagement = (hl + notes_n) / hours
    avg_quiz = round(sum(scores) / len(scores), 2) if scores else None
    cfg = settings_for(user)
    if cfg["explain_level"] != "auto":
        level = cfg["explain_level"]
    elif avg_quiz is not None and len(scores) >= 2:
        level = "simple" if avg_quiz < 0.5 else "expert" if avg_quiz >= 0.85 else "standard"
    else:
        level = "standard"
    cognitive = {
        "pace_wpm": pace,
        "pace_label": None if pace is None else "careful" if pace < 180 else "steady" if pace < 270 else "fast",
        "quiz_attempts": len(scores),
        "quiz_avg": avg_quiz,
        "quiz_trend": ("improving" if len(scores) >= 4 and sum(scores[:2]) / 2 > sum(scores[-2:]) / 2 + 0.1 else
                       "slipping" if len(scores) >= 4 and sum(scores[:2]) / 2 < sum(scores[-2:]) / 2 - 0.1 else "steady") if len(scores) >= 2 else None,
        "weak_documents": [{"id": i, "title": titles.get(i, "a document")} for i, _ in weak.most_common(2) if i in titles],
        "engagement": "deep" if engagement >= 6 else "active" if engagement >= 1.5 else "light",
        "explain_level": level,
        "scaffolding": "high" if level == "simple" else "low" if level == "expert" else "medium",
    }

    # ── wellbeing & mood ───────────────────────────────────────
    checkins = [e for e in events if e.kind == "checkin"][:7]
    affects = [e for e in events if e.kind == "affect"][:12]
    heavy = sum(1 for e in affects if (e.payload or {}).get("state") in ("overwhelmed", "anxious", "discouraged", "frustrated"))
    wellbeing = {
        "late_night_share": round(late / focus_total, 2) if focus_total else 0.0,
        "longest_session_min": round(longest / 60),
        "recent_checkins": [{"mood": (e.payload or {}).get("mood"), "at": _aware(e.created_at).isoformat()} for e in checkins],
        "recent_heavy_moments": heavy,
        "rest_hint": bool(focus_total and (late / focus_total > 0.35 or longest >= 3 * 3600)),
    }

    memories = db.scalars(select(AgentMemory).where(AgentMemory.owner_id == user.id).order_by(AgentMemory.created_at.desc()).limit(MAX_MEMORIES)).all()
    return {
        "settings": cfg,
        "behavior": behavior,
        "cognitive": cognitive,
        "wellbeing": wellbeing,
        "memories": [{"id": m.id, "kind": m.kind, "text": m.text, "source": m.source, "created_at": _aware(m.created_at).isoformat()} for m in memories],
        "generated_at": now.isoformat(),
    }


def prompt_block(p: dict) -> str:
    """The reader model as compact text for the system prompt. Only facts with enough data behind them."""
    b, c, w = p["behavior"], p["cognitive"], p["wellbeing"]
    lines = []
    if b["sessions"]:
        lines.append(f"Reads about {b['minutes_30d']} min over {b['active_days_30d']} of the last 30 days (avg session {b['avg_session_min']} min); "
                     f"current streak {b['streak']} day(s); reading time is {b['trend']}.")
        if b["peak_label"]:
            lines.append(f"Usually reads {b['peak_label']} (around {_hours_label(b['peak_hours'])}).")
        if b["preferred_mode"]:
            lines.append(f"Prefers {b['preferred_mode']} mode; {round(b['listening_share'] * 100)}% of their time is listening.")
    if b["in_progress"]:
        lines.append("In progress: " + "; ".join(f"“{d['title']}” {d['progress']}%" for d in b["in_progress"][:3]) + ".")
    if b["stalled"]:
        lines.append("Stalled: " + "; ".join(f"“{d['title']}” ({d['days_idle']} days idle)" for d in b["stalled"]) + ".")
    if c["pace_wpm"]:
        lines.append(f"Estimated reading pace ≈{c['pace_wpm']} wpm ({c['pace_label']}).")
    if c["quiz_attempts"] >= 2:
        lines.append(f"Quiz average {round(c['quiz_avg'] * 100)}% over {c['quiz_attempts']} quizzes ({c['quiz_trend']})."
                     + (" Struggles with: " + ", ".join(f"“{d['title']}”" for d in c["weak_documents"]) + "." if c["weak_documents"] else ""))
    lines.append(f"Explanations work best at a '{c['explain_level']}' level with {c['scaffolding']} scaffolding; engagement is {c['engagement']}.")
    if w["rest_hint"]:
        lines.append("Often reads very late or for very long stretches — encourage rest only if it fits, never lecture.")
    if w["recent_checkins"]:
        lines.append("Latest self-reported mood: " + w["recent_checkins"][0]["mood"] + ".")
    return "\n".join(lines) or "New reader: no history yet."
