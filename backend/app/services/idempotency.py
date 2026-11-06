"""Idempotency keys for requests that start expensive work (generate an audiobook, a deck, ...).

A client that retries after a timeout sends the same `Idempotency-Key`; the first result is replayed instead of starting a
second job. Reusing a key with a different request body is a client bug and is rejected.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from ..models import IdempotencyRecord, aware, utcnow

TTL = timedelta(hours=24)


def fingerprint(scope: str, body: dict) -> str:
    return hashlib.sha256((scope + "|" + json.dumps(body, sort_keys=True, default=str)).encode()).hexdigest()


def run(db, user_id: str, key: str | None, scope: str, body: dict, fn: Callable[[], dict]) -> tuple[dict, bool]:
    """(response, replayed). With no key this is just `fn()`."""
    if not key:
        return fn(), False
    if not (8 <= len(key) <= 128) or not key.isascii():
        raise HTTPException(status_code=422, detail="Idempotency-Key must be 8–128 ASCII characters")
    fp = fingerprint(scope, body)
    now = utcnow()
    existing = db.get(IdempotencyRecord, (user_id, key))
    if existing is not None and aware(existing.created_at) < now - TTL:
        db.delete(existing)
        db.commit()
        existing = None
    if existing is not None:
        if existing.fingerprint != fp:
            raise HTTPException(status_code=422, detail="This Idempotency-Key was already used with a different request")
        return existing.response, True
    response = fn()
    try:
        db.add(IdempotencyRecord(owner_id=user_id, key=key, fingerprint=fp, response=response))
        db.commit()
    except IntegrityError:  # a concurrent retry won the race: return what it stored
        db.rollback()
        winner = db.get(IdempotencyRecord, (user_id, key))
        if winner is not None:
            return winner.response, True
    return response, False
