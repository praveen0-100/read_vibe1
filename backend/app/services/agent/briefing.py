"""The companion's daily briefing: a few next-best-actions chosen from the reader's own rhythm.

Deterministic on purpose (instant, free, explainable): every card says *why* it is shown. The tone follows the reader —
after a tired or stressed check-in the cards get lighter, and a long absence gets a welcome back, never guilt.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import AgentEvent, Document, User
from .. import recommend
from . import empathy, profile

DEFAULT_WPM = 230


def _greeting(hour: int, name: str) -> str:
    first = (name or "").split(" ")[0]
    part = "Good morning" if 4 <= hour < 12 else "Good afternoon" if hour < 17 else "Good evening" if hour < 22 else "Still up"
    return f"{part}, {first}" if first else part


def _minutes_left(doc: Document, wpm: int) -> int:
    return max(1, round((doc.word_count or 0) * (1 - (doc.progress or 0) / 100) / wpm))


def build(db: Session, user: User, tz_offset: int = 0) -> dict:
    cfg = profile.settings_for(user)
    now_local = profile.local_now(tz_offset)
    hour = now_local.hour
    docs = list(db.scalars(select(Document).where(Document.owner_id == user.id, Document.status == "ready")))
    by_id = {d.id: d for d in docs}
    cards: list[dict] = []

    since_day = datetime.now(timezone.utc) - timedelta(hours=20)
    recent_checkin = db.scalars(select(AgentEvent).where(AgentEvent.owner_id == user.id, AgentEvent.kind == "checkin", AgentEvent.created_at >= since_day)
                                .order_by(AgentEvent.created_at.desc())).first()
    mood = (recent_checkin.payload or {}).get("mood") if recent_checkin else None
    light_day = mood in ("tired", "stressed", "low")

    greeting = _greeting(hour, user.name)
    result = {"greeting": greeting, "subline": "", "cards": cards, "needs_checkin": recent_checkin is None, "personalized": bool(cfg["personalize"]),
              "mood": mood, "mood_reply": empathy.CHECKIN_REPLIES.get(mood or "")}

    p = profile.build(db, user, tz_offset) if cfg["personalize"] else None
    wpm = (p and p["cognitive"]["pace_wpm"]) or DEFAULT_WPM
    in_progress = sorted([d for d in docs if 1 <= (d.progress or 0) < 95], key=lambda d: profile._aware(d.last_opened_at) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    if in_progress:
        d = in_progress[0]
        left = _minutes_left(d, wpm)
        short = min(left, 10 if light_day else 20)
        cards.append({
            "id": "continue", "kind": "continue", "icon": "book",
            "title": f"Pick up “{d.title}”",
            "body": f"You’re {round(d.progress)}% through — about {left} min to go. {f'A gentle {short} min is plenty today.' if light_day else f'Even {short} min moves it forward.'}",
            "reason": "Your most recent unfinished read", "cta": {"label": "Resume", "action": "open_doc", "document_id": d.id},
        })

    if p:
        b, c, w = p["behavior"], p["cognitive"], p["wellbeing"]
        result["subline"] = (
            "Let’s keep today light." if light_day else
            "Welcome back — no catching up needed, just start small." if (b["days_since_active"] or 0) >= 3 else
            f"{b['streak']}-day streak — nice rhythm." if b["streak"] >= 3 else
            "You’ve been reading more lately." if b["trend"] == "rising" else "")
        if (b["days_since_active"] or 0) >= 3 and in_progress:
            cards[0]["body"] = f"It’s been {b['days_since_active']} days, and that’s completely fine. {cards[0]['body']}"
        elif b["streak"] >= 2 and b["days_since_active"] != 0 and hour >= 17 and not light_day:
            cards.append({"id": "streak", "kind": "streak", "icon": "flame", "title": f"Keep your {b['streak']}-day streak",
                          "body": "You haven’t read yet today. Ten quiet minutes tonight is enough.", "reason": "You have a streak going and it’s evening",
                          "cta": {"label": "Open library", "action": "go", "to": "/library"}})
        if c["weak_documents"]:
            d = c["weak_documents"][0]
            cards.append({"id": "review", "kind": "review", "icon": "brain", "title": f"Revisit “{d['title']}”",
                          "body": "Your recent quiz scores there were lower. A short quiz now helps it stick.", "reason": "Based on your quiz results",
                          "cta": {"label": "Quiz me", "action": "open_tool", "tool": "quiz", "document_id": d["id"]}})
        if b["stalled"] and not light_day:
            s = b["stalled"][0]
            cards.append({"id": "stalled", "kind": "stalled", "icon": "clock", "title": f"“{s['title']}” is waiting",
                          "body": f"Left at {s['progress']}% {s['days_idle']} days ago. Want a two-line recap to ease back in?", "reason": "Unfinished for over a week",
                          "cta": {"label": "Recap", "action": "ask", "document_id": s["id"], "question": "Give me a short recap of where I left off and what comes next."}})
        if w["rest_hint"] and (hour >= 22 or hour < 5):
            cards.append({"id": "rest", "kind": "wellbeing", "icon": "moon", "title": "Easy on the eyes tonight",
                          "body": "You often read late. Listening mode is a restful way to carry on.", "reason": "You read late at night fairly often",
                          "cta": {"label": "Listen instead", "action": "go", "to": "/audio"}})
        elif b["peak_label"] and b["sessions"] >= 6 and not light_day:
            cards.append({"id": "rhythm", "kind": "insight", "icon": "sparkles", "title": f"You read best {b['peak_label']}",
                          "body": f"Most of your focused time lands around {profile._hours_label(b['peak_hours'])}. Protecting that window is the easiest habit win.",
                          "reason": f"From {b['sessions']} recent sessions", "cta": None})

    built = recommend.build(docs)
    for r in built["related"]:
        d = by_id.get(r["doc_id"])
        if d and (d.progress or 0) < 5 and not light_day:
            cards.append({"id": "next", "kind": "recommend", "icon": "compass", "title": f"Next up: “{d.title}”", "body": r["reason"],
                          "reason": "Related to books you engage with", "cta": {"label": "Open", "action": "open_doc", "document_id": d.id}})
            break

    if not docs:
        cards.append({"id": "start", "kind": "start", "icon": "upload", "title": "Add your first book",
                      "body": "Upload a PDF, EPUB or text, or pick a classic from Discover. I’ll learn your rhythm as you read.", "reason": "Your library is empty",
                      "cta": {"label": "Discover books", "action": "go", "to": "/discover"}})

    result["cards"] = cards[:4]
    return result
