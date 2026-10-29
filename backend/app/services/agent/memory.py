"""Long-term memory: short facts about the reader's goals, preferences and struggles.

Added from what the reader says outright ("I'm preparing for my GATE exam", "keep answers short") or by the model's
`remember` tool. Capped, de-duplicated, visible in Settings and deletable one by one or all at once.
"""
from __future__ import annotations

import re

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ...models import AgentEvent, AgentMemory
from .profile import MAX_MEMORIES

KINDS = ("goal", "preference", "interest", "struggle", "fact")
_END = r"(?=[.,;!?\n]|$| because| so | and i )"
_PATTERNS: tuple[tuple[str, re.Pattern, str], ...] = (
    ("goal", re.compile(r"\bi(?:'m| am| have to| need to| must) (?:preparing|studying|revising|getting ready|cramming) for (?:my |an? |the )?(.{3,60}?)" + _END, re.I), "Preparing for {}"),
    ("goal", re.compile(r"\bmy (?:goal|aim|target) is (?:to )?(.{3,80}?)" + _END, re.I), "Goal: {}"),
    ("goal", re.compile(r"\bi want to (?:learn|understand|master|finish|get better at|improve my) (.{3,60}?)" + _END, re.I), "Wants to learn/finish {}"),
    ("preference", re.compile(r"\b(?:please )?(?:keep|make) (?:it|answers?|replies|responses|explanations?) (short|brief|concise|simple|detailed|shorter|simpler)\b", re.I), "Prefers {} answers"),
    ("preference", re.compile(r"\bexplain (?:it |things )?(?:like|as if) i(?:'m| am) (?:a |an )?(\w+(?: \w+)?)", re.I), "Likes explanations pitched like “{}”"),
    ("preference", re.compile(r"\b(?:reply|answer|respond|speak|talk|explain) (?:to me )?in (tamil|telugu|malayalam|kannada|hindi|bengali|marathi|gujarati|punjabi|urdu|english)\b", re.I), "Prefers replies in {}"),
    ("struggle", re.compile(r"\bi (?:struggle|have trouble|find it (?:hard|difficult)) (?:with|to|understanding) (.{3,60}?)" + _END, re.I), "Finds {} hard"),
    ("interest", re.compile(r"\bi(?:'m| am) (?:really |very )?(?:into|interested in|fascinated by) (.{3,50}?)" + _END, re.I), "Interested in {}"),
)


def _norm(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.lower()).strip()


def extract(message: str) -> list[tuple[str, str]]:
    """(kind, text) facts the reader stated outright. Conservative on purpose."""
    found: list[tuple[str, str]] = []
    for kind, pattern, template in _PATTERNS:
        m = pattern.search(message)
        if m:
            value = m.group(1).strip(" .,'\"")
            if value:
                text = template.format(value[:1].upper() + value[1:] if template.startswith("{}") else value)[:300]
                found.append((kind, text))
    return found[:3]


def remember(db: Session, owner_id: str, kind: str, text: str, source: str = "inferred") -> AgentMemory | None:
    text = " ".join(text.split())[:300]
    if len(text) < 4:
        return None
    kind = kind if kind in KINDS else "fact"
    existing = db.scalars(select(AgentMemory).where(AgentMemory.owner_id == owner_id).order_by(AgentMemory.created_at.desc())).all()
    key = _norm(text)
    for m in existing:
        if _norm(m.text) == key:
            return m
    row = AgentMemory(owner_id=owner_id, kind=kind, text=text, source=source)
    db.add(row)
    for old in existing[MAX_MEMORIES - 1:]:  # keep the newest MAX_MEMORIES
        db.delete(old)
    db.commit()
    return row


def recall(db: Session, owner_id: str, limit: int = 12) -> list[AgentMemory]:
    return list(db.scalars(select(AgentMemory).where(AgentMemory.owner_id == owner_id).order_by(AgentMemory.created_at.desc()).limit(limit)))


def forget(db: Session, owner_id: str, memory_id: str) -> bool:
    row = db.get(AgentMemory, memory_id)
    if not row or row.owner_id != owner_id:
        return False
    db.delete(row)
    db.commit()
    return True


def forget_everything(db: Session, owner_id: str) -> dict:
    mem = db.execute(delete(AgentMemory).where(AgentMemory.owner_id == owner_id)).rowcount
    ev = db.execute(delete(AgentEvent).where(AgentEvent.owner_id == owner_id)).rowcount
    db.commit()
    return {"memories": mem, "events": ev}


def record_event(db: Session, owner_id: str, kind: str, payload: dict, document_id: str | None = None) -> None:
    db.add(AgentEvent(owner_id=owner_id, kind=kind, document_id=document_id, payload=payload))
    db.commit()
