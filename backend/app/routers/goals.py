"""Reading goals and progress: daily/weekly targets, goal streaks, and a 12-week activity heatmap."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import DB, CurrentUser
from ..models import ReadingSession, ReviewLog, utcnow, aware

router = APIRouter(prefix="/goals", tags=["goals"])

DEFAULTS = {"daily_minutes": 20, "weekly_days": 5, "cards_per_day": 10}
HEATMAP_DAYS = 84


class GoalsIn(BaseModel):
    daily_minutes: int = Field(ge=5, le=600)
    weekly_days: int = Field(ge=1, le=7)
    cards_per_day: int = Field(ge=0, le=200)


def goals_of(user) -> dict:
    return {**DEFAULTS, **((user.preferences or {}).get("goals") or {})}


def _day(dt: datetime, tz_offset: int) -> date:
    """The reader's local calendar day (tz_offset is JS Date.getTimezoneOffset(): minutes behind UTC)."""
    return (aware(dt) - timedelta(minutes=tz_offset)).date()


@router.get("")
def get_goals(user: CurrentUser):
    return goals_of(user)


@router.put("")
def set_goals(body: GoalsIn, user: CurrentUser, db: DB):
    prefs = dict(user.preferences or {})
    prefs["goals"] = body.model_dump()
    user.preferences = prefs  # reassign so the JSON column change is detected
    db.commit()
    return goals_of(user)


@router.get("/progress")
def progress(user: CurrentUser, db: DB, tz_offset: int = Query(0, ge=-900, le=900)):
    goals = goals_of(user)
    now = utcnow()
    today = _day(now, tz_offset)
    since = now - timedelta(days=HEATMAP_DAYS + 2)
    minutes: dict[date, float] = {}
    for s in db.scalars(select(ReadingSession).where(ReadingSession.owner_id == user.id, ReadingSession.started_at >= since)):
        if s.kind in ("reading", "focus", "listening"):
            d = _day(s.started_at, tz_offset)
            minutes[d] = minutes.get(d, 0) + s.seconds / 60
    cards: dict[date, int] = {}
    for r in db.scalars(select(ReviewLog).where(ReviewLog.owner_id == user.id, ReviewLog.at >= since)):
        d = _day(r.at, tz_offset)
        cards[d] = cards.get(d, 0) + 1

    target = goals["daily_minutes"]
    met = lambda d: minutes.get(d, 0) >= target  # noqa: E731

    # streak = consecutive days that met the goal; today only counts once met (it doesn't break a streak while still open)
    streak, cursor = 0, today if met(today) else today - timedelta(days=1)
    while met(cursor):
        streak += 1
        cursor -= timedelta(days=1)
    longest = run = 0
    for i in range(HEATMAP_DAYS, -1, -1):
        run = run + 1 if met(today - timedelta(days=i)) else 0
        longest = max(longest, run)

    week_start = today - timedelta(days=today.weekday())
    week_days_met = sum(1 for i in range(7) if (week_start + timedelta(days=i)) <= today and met(week_start + timedelta(days=i)))
    heat = [{"date": (today - timedelta(days=i)).isoformat(), "minutes": round(minutes.get(today - timedelta(days=i), 0))} for i in range(HEATMAP_DAYS - 1, -1, -1)]
    today_min = round(minutes.get(today, 0))
    return {
        "goals": goals,
        "today": {"minutes": today_min, "goal": target, "percent": min(100, round(100 * today_min / target)), "met": met(today),
                  "cards": cards.get(today, 0), "cards_goal": goals["cards_per_day"], "cards_met": goals["cards_per_day"] == 0 or cards.get(today, 0) >= goals["cards_per_day"]},
        "week": {"days_met": week_days_met, "goal": goals["weekly_days"], "met": week_days_met >= goals["weekly_days"]},
        "streak": streak,
        "longest_streak": longest,
        "heatmap": heat,
        "active_days_84": sum(1 for h in heat if h["minutes"] > 0),
    }
