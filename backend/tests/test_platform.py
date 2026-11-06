"""Platform hardening: TOTP two-factor, login lockout + audit trail, security headers, metrics, idempotency, SM-2 study queue."""
import base64
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.database import SessionLocal
from app.models import Card, User
from app.seed import FOCUSED_READING
from app.services import metrics, srs, totp


def _register(client, email, password="supersecret1"):
    r = client.post("/api/auth/register", json={"name": "Sec Tester", "email": email, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, password


# ─── TOTP (RFC 6238 Appendix B vectors, SHA-1, 8 digits) ───────────────────────
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()


@pytest.mark.parametrize("t,expected", [(59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"), (1234567890, "89005924"), (2000000000, "69279037")])
def test_totp_matches_rfc6238_vectors(t, expected):
    assert totp.code_at(RFC_SECRET, t // 30, digits=8) == expected


def test_totp_window_replay_and_garbage():
    secret = totp.new_secret()
    now = 1_700_000_000
    code = totp.code_at(secret, totp.current_step(now))
    assert totp.verify(secret, code, now=now) == totp.current_step(now)
    assert totp.verify(secret, code, now=now + 30) is not None          # one step of clock drift tolerated
    assert totp.verify(secret, code, now=now + 120) is None             # but not minutes
    assert totp.verify(secret, code, now=now, last_step=totp.current_step(now)) is None  # replay of a used step
    for bad in ("", "abc123", "12345", "1234567", None):
        assert totp.verify(secret, bad, now=now) is None


# ─── two-factor flow ──────────────────────────────────────────────────────────
def test_two_factor_enrol_login_and_backup_code(client):
    auth, password = _register(client, "mfa@example.com")
    setup = client.post("/api/auth/2fa/setup", headers=auth).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/ReadVibe:") and setup["secret"]
    with SessionLocal() as db:  # the seed is encrypted at rest, never stored as plain base32
        assert setup["secret"] not in (db.query(User).filter_by(email="mfa@example.com").one().totp_secret or "")
    assert client.post("/api/auth/2fa/enable", headers=auth, json={"code": "000000"}).status_code == 400
    code = totp.code_at(setup["secret"], totp.current_step())
    enabled = client.post("/api/auth/2fa/enable", headers=auth, json={"code": code}).json()
    assert enabled["enabled"] and len(enabled["backup_codes"]) == 8

    # password alone no longer opens a session
    first = client.post("/api/auth/login", json={"email": "mfa@example.com", "password": password}).json()
    assert first["mfa_required"] is True and "access_token" not in first
    # the mfa token is not a session token
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {first['mfa_token']}"}).status_code == 401
    assert client.post("/api/auth/2fa/verify", json={"mfa_token": first["mfa_token"], "code": "111111"}).status_code == 401

    # the TOTP step used to enrol cannot be replayed to sign in
    assert client.post("/api/auth/2fa/verify", json={"mfa_token": first["mfa_token"], "code": code}).status_code == 401
    # a recovery code works exactly once
    backup = enabled["backup_codes"][0]
    ok = client.post("/api/auth/2fa/verify", json={"mfa_token": first["mfa_token"], "code": backup})
    assert ok.status_code == 200 and ok.json()["access_token"]
    again = client.post("/api/auth/login", json={"email": "mfa@example.com", "password": password}).json()
    assert client.post("/api/auth/2fa/verify", json={"mfa_token": again["mfa_token"], "code": backup}).status_code == 401

    sec = client.get("/api/auth/security", headers=auth).json()
    assert sec["two_factor"] is True and sec["backup_codes_left"] == 7
    assert "backup_code_used" in {e["event"] for e in sec["events"]} and "mfa_enabled" in {e["event"] for e in sec["events"]}


def test_disable_requires_password_and_code(client):
    auth, password = _register(client, "mfa2@example.com")
    secret = client.post("/api/auth/2fa/setup", headers=auth).json()["secret"]
    step = totp.current_step()
    client.post("/api/auth/2fa/enable", headers=auth, json={"code": totp.code_at(secret, step)})
    nxt = totp.code_at(secret, step + 1)  # a fresh step (the enrolment step is spent)
    assert client.post("/api/auth/2fa/disable", headers=auth, json={"code": nxt, "password": "wrong-password"}).status_code == 400
    assert client.post("/api/auth/2fa/disable", headers=auth, json={"code": nxt, "password": password}).json()["enabled"] is False
    assert "access_token" in client.post("/api/auth/login", json={"email": "mfa2@example.com", "password": password}).json()


# ─── lockout + audit ──────────────────────────────────────────────────────────
def test_lockout_after_repeated_failures_and_audit_trail(client):
    auth, password = _register(client, "lock@example.com")
    limit = get_settings().login_max_failures
    for _ in range(limit):
        assert client.post("/api/auth/login", json={"email": "lock@example.com", "password": "nope-nope"}).status_code == 401
    locked = client.post("/api/auth/login", json={"email": "lock@example.com", "password": password})  # even the right password
    assert locked.status_code == 429 and int(locked.headers["Retry-After"]) > 0
    events = [e["event"] for e in client.get("/api/auth/security", headers=auth).json()["events"]]
    assert events.count("login_failed") == limit and "login_locked" in events
    with SessionLocal() as db:  # lock expires -> the right password works again and the counter resets
        u = db.query(User).filter_by(email="lock@example.com").one()
        u.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.post("/api/auth/login", json={"email": "lock@example.com", "password": password}).status_code == 200


def test_unknown_email_gets_the_same_answer_as_a_wrong_password(client):
    _register(client, "known@example.com")
    a = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "whatever1"})
    b = client.post("/api/auth/login", json={"email": "known@example.com", "password": "whatever1"})
    assert (a.status_code, a.json()) == (b.status_code, b.json()) == (401, {"detail": "Incorrect email or password"})


# ─── headers, metrics, readiness ──────────────────────────────────────────────
def test_security_headers_on_api_responses(client):
    r = client.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY" and r.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert "strict-transport-security" not in r.headers
    assert "max-age" in client.get("/api/health", headers={"X-Forwarded-Proto": "https"}).headers["strict-transport-security"]


def test_metrics_disabled_by_default_then_token_protected(client, monkeypatch):
    assert client.get("/api/metrics").status_code == 404
    monkeypatch.setattr(get_settings(), "metrics_token", "s3cret-metrics-token")
    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
    client.get("/api/health")
    body = client.get("/api/metrics", headers={"Authorization": "Bearer s3cret-metrics-token"}).text
    assert 'readvibe_http_requests_total{method="GET",route="/api/health",status="2xx"}' in body
    assert "readvibe_http_request_duration_seconds_bucket" in body and "readvibe_up 1" in body
    assert 'readvibe_auth_login_failed_total' in body or "readvibe_auth_login_success_total" in body


def test_metrics_use_route_templates_not_raw_urls(client, auth, monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "tok-tok-tok-tok")
    client.get("/api/documents/abc123", headers=auth)
    body = client.get("/api/metrics", headers={"Authorization": "Bearer tok-tok-tok-tok"}).text
    assert "/api/documents/{document_id}" in body and "abc123" not in body


def test_readiness_probe(client):
    assert client.get("/api/ready").json() == {"status": "ready"}


# ─── idempotency ──────────────────────────────────────────────────────────────
def test_idempotency_key_replays_instead_of_starting_a_second_job(client, auth):
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Idem", "content": FOCUSED_READING}).json()
    body = {"document_id": doc["id"], "tone": "Regular"}
    h = {**auth, "Idempotency-Key": "retry-key-0001"}
    first = client.post("/api/audio/audiobooks", headers=h, json=body)
    second = client.post("/api/audio/audiobooks", headers=h, json=body)
    assert first.status_code == second.status_code == 202
    assert second.json() == first.json() and second.headers["idempotent-replay"] == "true" and "idempotent-replay" not in first.headers
    mine = [b for b in client.get("/api/audio/audiobooks", headers=auth).json() if b["document_id"] == doc["id"]]
    assert len(mine) == 1
    # the same key for a different request is a client bug
    assert client.post("/api/audio/audiobooks", headers=h, json={**body, "tone": "Humor"}).status_code == 422
    # without a key every request is its own job
    client.post("/api/audio/audiobooks", headers=auth, json=body)
    client.post("/api/audio/audiobooks", headers=auth, json=body)
    assert len([b for b in client.get("/api/audio/audiobooks", headers=auth).json() if b["document_id"] == doc["id"]]) == 3
    assert client.post("/api/audio/audiobooks", headers={**auth, "Idempotency-Key": "short"}, json=body).status_code == 422


def test_idempotency_keys_are_per_user(client, auth, demo):
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Scoped", "content": FOCUSED_READING}).json()
    key = {"Idempotency-Key": "shared-key-12345"}
    a = client.post("/api/audio/audiobooks", headers={**auth, **key}, json={"document_id": doc["id"], "tone": "Regular"})
    b = client.post("/api/audio/audiobooks", headers={**demo, **key}, json={"document_id": doc["id"], "tone": "Regular"})
    assert a.status_code == 202 and b.status_code == 404  # another user's key store is separate; the document isn't theirs


# ─── SM-2 ─────────────────────────────────────────────────────────────────────
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_sm2_interval_growth_lapse_and_ease_floor():
    s = srs.State()
    s, due = srs.schedule(s, "good", NOW)
    assert (s.interval_days, s.reps, due) == (1, 1, NOW + timedelta(days=1))
    s, _ = srs.schedule(s, "good", NOW)
    assert s.interval_days == 6
    s, _ = srs.schedule(s, "good", NOW)
    assert s.interval_days == round(6 * 2.5)  # previous interval x ease
    grown = s
    s, due = srs.schedule(s, "again", NOW)
    assert (s.interval_days, s.reps, s.lapses) == (0, 0, 1) and due == NOW + timedelta(minutes=srs.RELEARN_MINUTES) and s.ease < grown.ease
    floor = srs.State(ease=1.35)
    for _ in range(10):
        floor, _ = srs.schedule(floor, "again", NOW)
    assert floor.ease == srs.MIN_EASE
    easy, _ = srs.schedule(srs.State(ease=2.5, interval_days=10, reps=3), "easy", NOW)
    hard, _ = srs.schedule(srs.State(ease=2.5, interval_days=10, reps=3), "hard", NOW)
    assert easy.interval_days > hard.interval_days and easy.ease > hard.ease


def test_cloze_blanks_the_first_key_phrase():
    assert srs.cloze("Spaced repetition beats cramming.", ["spaced repetition"]) == ("_____ beats cramming.", "Spaced repetition")
    assert srs.cloze("Nothing here.", ["zebra"]) is None


# ─── study API ────────────────────────────────────────────────────────────────
def test_study_cards_from_highlights_review_and_stats(client):
    auth, _ = _register(client, "study@example.com")
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Study", "content": FOCUSED_READING}).json()
    for text in ("deep focus", "spaced repetition"):
        client.post(f"/api/documents/{doc['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": text})
    made = client.post("/api/study/from-highlights", headers=auth, json={"document_id": doc["id"]}).json()
    assert made["created"] == 2
    assert client.post("/api/study/from-highlights", headers=auth, json={"document_id": doc["id"]}).json()["created"] == 0  # no duplicates
    q = client.get("/api/study/queue", headers=auth).json()
    assert q["due"] == 2 and len(q["cards"]) == 2
    card = q["cards"][0]
    r = client.post(f"/api/study/cards/{card['id']}/review", headers=auth, json={"grade": "good"}).json()
    assert r["reps"] == 1 and r["interval_days"] == 1
    assert client.get("/api/study/queue", headers=auth).json()["due"] == 1  # the reviewed card is no longer due
    again = client.post(f"/api/study/cards/{q['cards'][1]['id']}/review", headers=auth, json={"grade": "again"}).json()
    assert again["lapses"] == 1
    stats = client.get("/api/study/stats", headers=auth).json()
    assert stats["total"] == 2 and stats["reviewed_today"] == 2 and stats["streak_days"] == 1 and stats["retention_30d"] == 0.5
    assert client.post(f"/api/study/cards/{card['id']}/review", headers=auth, json={"grade": "meh"}).status_code == 422


def test_study_manual_cards_suspend_delete_and_privacy(client, auth, demo):
    c = client.post("/api/study/cards", headers=auth, json={"front": "Capital of France?", "back": "Paris"}).json()
    assert client.post(f"/api/study/cards/{c['id']}/review", headers=demo, json={"grade": "good"}).status_code == 404
    assert client.patch(f"/api/study/cards/{c['id']}", headers=auth, json={"suspended": True}).json()["suspended"] is True
    assert c["id"] not in [x["id"] for x in client.get("/api/study/queue", headers=auth).json()["cards"]]
    assert client.delete(f"/api/study/cards/{c['id']}", headers=auth).status_code == 204
    with SessionLocal() as db:
        assert db.get(Card, c["id"]) is None


def test_study_from_document_generates_term_definition_cards(client, auth):
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Terms", "content": FOCUSED_READING}).json()
    out = client.post("/api/study/from-document", headers=auth, json={"document_id": doc["id"], "count": 5}).json()
    assert out["created"] == len(out["cards"]) <= 5
    again = client.post("/api/study/from-document", headers=auth, json={"document_id": doc["id"], "count": 5}).json()
    assert {c["front"].lower() for c in again["cards"]}.isdisjoint({c["front"].lower() for c in out["cards"]})  # never repeats a term
