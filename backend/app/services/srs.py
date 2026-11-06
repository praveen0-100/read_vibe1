"""Spaced repetition: the SM-2 scheduling algorithm with four answer buttons.

Again / Hard / Good / Easy map to SM-2 qualities 1 / 3 / 4 / 5. A lapse (Again) resets the card to relearn in minutes;
successful reviews grow the interval 1 day -> 6 days -> previous x ease, and ease drifts with how easy the card felt.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

GRADES = {"again": 1, "hard": 3, "good": 4, "easy": 5}
MIN_EASE = 1.3
RELEARN_MINUTES = 10
MATURE_DAYS = 21


@dataclass
class State:
    ease: float = 2.5
    interval_days: int = 0
    reps: int = 0
    lapses: int = 0


def schedule(state: State, grade: str, now: datetime) -> tuple[State, datetime]:
    """The card's next state and due time after answering with `grade`."""
    q = GRADES[grade]
    ease = state.ease
    if q < 3:
        nxt = State(ease=max(MIN_EASE, ease - 0.2), interval_days=0, reps=0, lapses=state.lapses + 1)
        return nxt, now + timedelta(minutes=RELEARN_MINUTES)
    reps = state.reps + 1
    if reps == 1:
        interval = 1
    elif reps == 2:
        interval = 6
    else:
        interval = max(state.interval_days + 1, round(state.interval_days * ease * (1.2 if q == 3 else 1.0) * (1.3 if q == 5 else 1.0)))
    ease = max(MIN_EASE, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    return State(ease=round(ease, 3), interval_days=interval, reps=reps, lapses=state.lapses), now + timedelta(days=interval)


def cloze(text: str, phrases: list[str]) -> tuple[str, str] | None:
    """Hide the first key phrase found in `text`: (question with a blank, the hidden phrase). None when nothing fits."""
    low = text.lower()
    for p in phrases:
        i = low.find(p.lower())
        if i >= 0 and len(p) >= 3:
            return text[:i] + "_____" + text[i + len(p):], text[i:i + len(p)]
    return None
