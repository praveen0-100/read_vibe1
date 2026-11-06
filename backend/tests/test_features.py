"""Goals + streaks, collections, duplicate detection, share links, and portable exports."""
import csv
import io
from datetime import timedelta

from app.database import SessionLocal
from app.models import Collection, ReadingSession, ShareLink, User, utcnow
from app.seed import FOCUSED_READING


def _register(client, email):
    r = client.post("/api/auth/register", json={"name": "Feature Tester", "email": email, "password": "supersecret1"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _doc(client, auth, title="Doc", content=FOCUSED_READING):
    return client.post("/api/documents/text", headers=auth, json={"title": title, "content": content}).json()


def _session(email, days_ago, minutes, kind="reading"):
    with SessionLocal() as db:
        uid = db.query(User).filter_by(email=email).one().id
        db.add(ReadingSession(owner_id=uid, kind=kind, seconds=minutes * 60, started_at=utcnow() - timedelta(days=days_ago, hours=0)))
        db.commit()


# ─── goals ────────────────────────────────────────────────────────────────────
def test_goals_default_set_validate_and_persist(client):
    auth = _register(client, "goals1@example.com")
    assert client.get("/api/goals", headers=auth).json() == {"daily_minutes": 20, "weekly_days": 5, "cards_per_day": 10}
    ok = client.put("/api/goals", headers=auth, json={"daily_minutes": 30, "weekly_days": 4, "cards_per_day": 0}).json()
    assert ok["daily_minutes"] == 30 and client.get("/api/goals", headers=auth).json()["weekly_days"] == 4
    for bad in ({"daily_minutes": 1, "weekly_days": 4, "cards_per_day": 0}, {"daily_minutes": 30, "weekly_days": 9, "cards_per_day": 0}, {"daily_minutes": 30, "weekly_days": 4, "cards_per_day": -1}):
        assert client.put("/api/goals", headers=auth, json=bad).status_code == 422


def test_goal_progress_streak_counts_only_days_that_met_the_goal(client):
    auth = _register(client, "goals2@example.com")
    client.put("/api/goals", headers=auth, json={"daily_minutes": 20, "weekly_days": 3, "cards_per_day": 0})
    _session("goals2@example.com", 0, 25)          # today: met
    _session("goals2@example.com", 1, 20)          # yesterday: exactly the goal
    _session("goals2@example.com", 2, 5)           # too short: breaks the run
    _session("goals2@example.com", 3, 40)
    _session("goals2@example.com", 1, 3, "listening")  # listening adds to the same day
    p = client.get("/api/goals/progress", headers=auth).json()
    assert p["today"]["met"] is True and p["today"]["minutes"] == 25 and p["today"]["percent"] == 100
    assert p["streak"] == 2 and p["longest_streak"] == 2
    assert len(p["heatmap"]) == 84 and p["heatmap"][-1]["minutes"] == 25 and p["active_days_84"] == 4
    assert p["today"]["cards_met"] is True  # no card goal set


def test_open_day_does_not_break_a_streak(client):
    auth = _register(client, "goals3@example.com")
    client.put("/api/goals", headers=auth, json={"daily_minutes": 20, "weekly_days": 3, "cards_per_day": 0})
    _session("goals3@example.com", 1, 30)
    _session("goals3@example.com", 2, 30)
    p = client.get("/api/goals/progress", headers=auth).json()
    assert p["today"]["met"] is False and p["streak"] == 2  # today is still open


def test_goals_are_private(client):
    a, b = _register(client, "goals4@example.com"), _register(client, "goals5@example.com")
    client.put("/api/goals", headers=a, json={"daily_minutes": 90, "weekly_days": 7, "cards_per_day": 50})
    assert client.get("/api/goals", headers=b).json()["daily_minutes"] == 20
    assert client.get("/api/goals").status_code == 401


# ─── collections ──────────────────────────────────────────────────────────────
def test_collections_crud_membership_and_documents_survive_deletion(client):
    auth = _register(client, "col1@example.com")
    d1, d2 = _doc(client, auth, "One"), _doc(client, auth, "Two", FOCUSED_READING + " extra words here")
    c = client.post("/api/collections", headers=auth, json={"name": " Semester 7 ", "color": "blue"}).json()
    assert c["name"] == "Semester 7" and c["count"] == 0
    for d in (d1, d2, d1):  # adding twice is a no-op
        r = client.post(f"/api/collections/{c['id']}/documents", headers=auth, json={"document_id": d["id"]}).json()
    assert r["document_ids"] == [d1["id"], d2["id"]]
    assert client.patch(f"/api/collections/{c['id']}", headers=auth, json={"name": "Sem 7", "color": "rose"}).json()["color"] == "rose"
    assert client.delete(f"/api/collections/{c['id']}/documents/{d1['id']}", headers=auth).json()["document_ids"] == [d2["id"]]
    assert client.get("/api/collections", headers=auth).json()[0]["count"] == 1
    assert client.delete(f"/api/collections/{c['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/documents/{d2['id']}", headers=auth).status_code == 200  # the shelf went, the book stayed


def test_collections_validation_and_privacy(client):
    a, b = _register(client, "col2@example.com"), _register(client, "col3@example.com")
    c = client.post("/api/collections", headers=a, json={"name": "Mine"}).json()
    da = _doc(client, a)
    assert client.post("/api/collections", headers=a, json={"name": "x", "color": "puce"}).status_code == 422
    assert client.post("/api/collections", headers=a, json={"name": ""}).status_code == 422
    assert client.post(f"/api/collections/{c['id']}/documents", headers=b, json={"document_id": da["id"]}).status_code == 404
    db_ = _doc(client, b, "Theirs")
    assert client.post(f"/api/collections/{c['id']}/documents", headers=a, json={"document_id": db_["id"]}).status_code == 404  # can't shelve someone else's book
    assert client.get("/api/collections", headers=b).json() == []


# ─── duplicate detection ──────────────────────────────────────────────────────
def test_identical_upload_is_flagged_as_a_duplicate_not_rejected(client):
    auth = _register(client, "dup1@example.com")
    body = ("Duplicate detection sample text about reading habits and memory. " * 20).encode()
    up = lambda name: client.post("/api/documents/upload", headers=auth, files={"file": (name, body, "text/plain")}).json()["document"]  # noqa: E731
    first, second, other = up("a.txt"), up("b.txt"), client.post("/api/documents/upload", headers=auth, files={"file": ("c.txt", body + b"!", "text/plain")}).json()["document"]
    get = lambda d: client.get(f"/api/documents/{d['id']}", headers=auth).json()  # noqa: E731
    assert get(first)["duplicate_of"] is None
    assert get(second)["duplicate_of"] == first["id"] and get(second)["status"] == "ready"  # still imported
    assert get(other)["duplicate_of"] is None  # one byte different is a different document


def test_duplicates_are_per_user_and_pasted_text_counts(client):
    a, b = _register(client, "dup2@example.com"), _register(client, "dup3@example.com")
    text = "Pasted words that appear twice in one library but only once in another. " * 10
    one, two = _doc(client, a, "T1", text), _doc(client, a, "T2", text)
    assert one["duplicate_of"] is None and two["duplicate_of"] == one["id"]
    assert _doc(client, b, "Other user", text)["duplicate_of"] is None  # never reveals that someone else has the same file


# ─── share links ──────────────────────────────────────────────────────────────
def test_share_link_round_trip_hides_notes_unless_chosen_and_never_stores_the_token(client):
    auth = _register(client, "share1@example.com")
    d = _doc(client, auth, "Shared book")
    client.post(f"/api/documents/{d['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": "deep focus", "note": "my private thought", "marks": {"highlight": "blue"}})
    plain = client.post("/api/shares", headers=auth, json={"document_id": d["id"], "expires_days": 7}).json()
    assert plain["token"] and plain["path"] == f"/s/{plain['token']}" and plain["status"] == "active"
    with SessionLocal() as db:
        assert db.query(ShareLink).filter_by(id=plain["id"]).one().token_hash != plain["token"]
        assert plain["token"] not in str([r.__dict__ for r in db.query(ShareLink).all()])
    pub = client.get(f"/api/shared/{plain['token']}")  # no auth header
    assert pub.status_code == 200
    body = pub.json()
    assert body["title"] == "Shared book" and body["highlights"][0]["text"] == "deep focus" and body["highlights"][0]["marks"] == {"highlight": "blue"}
    assert "note" not in body["highlights"][0] and "email" not in str(body)
    withnotes = client.post("/api/shares", headers=auth, json={"document_id": d["id"], "include_notes": True}).json()
    assert client.get(f"/api/shared/{withnotes['token']}").json()["highlights"][0]["note"] == "my private thought"
    listed = {s["id"]: s for s in client.get("/api/shares", headers=auth).json()}
    assert listed[plain["id"]]["views"] == 1 and "token" not in listed[plain["id"]]


def test_revoked_expired_and_unknown_links_look_identical(client):
    auth = _register(client, "share2@example.com")
    d = _doc(client, auth)
    s = client.post("/api/shares", headers=auth, json={"document_id": d["id"]}).json()
    assert client.delete(f"/api/shares/{s['id']}", headers=auth).status_code == 204
    revoked = client.get(f"/api/shared/{s['token']}")
    e = client.post("/api/shares", headers=auth, json={"document_id": d["id"]}).json()
    with SessionLocal() as db:
        row = db.query(ShareLink).filter_by(id=e["id"]).one()
        row.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    expired = client.get(f"/api/shared/{e['token']}")
    unknown = client.get("/api/shared/not-a-real-token-at-all")
    assert {r.status_code for r in (revoked, expired, unknown)} == {404}
    assert revoked.json() == expired.json() == unknown.json()  # a token can't be probed for existence


def test_share_privacy_validation_and_cleanup(client):
    a, b = _register(client, "share3@example.com"), _register(client, "share4@example.com")
    d = _doc(client, a)
    assert client.post("/api/shares", headers=b, json={"document_id": d["id"]}).status_code == 404
    assert client.post("/api/shares", headers=a, json={"document_id": d["id"], "expires_days": 365}).status_code == 422
    s = client.post("/api/shares", headers=a, json={"document_id": d["id"]}).json()
    assert client.delete(f"/api/shares/{s['id']}", headers=b).status_code == 404
    assert client.get("/api/shares", headers=b).json() == []
    assert client.delete(f"/api/documents/{d['id']}", headers=a).status_code == 204
    assert client.get(f"/api/shared/{s['token']}").status_code == 404  # deleting the book kills its links


# ─── exports ──────────────────────────────────────────────────────────────────
def test_highlights_export_markdown_and_csv_with_formula_guard(client):
    auth = _register(client, "exp1@example.com")
    d = _doc(client, auth, "Export me")
    client.post(f"/api/documents/{d['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": "plain quote", "note": "a note", "pinned": True, "marks": {"highlight": "green", "underline": "red"}})
    client.post(f"/api/documents/{d['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": "=HYPERLINK(\"http://evil\",\"x\")", "note": "+cmd"})
    md = client.get(f"/api/documents/{d['id']}/highlights/export", headers=auth)
    assert md.headers["content-type"].startswith("text/markdown") and 'filename="Export_me-highlights.md"' in md.headers["content-disposition"]
    assert "# Export me" in md.text and "> plain quote 📌" in md.text and "green highlight, red underline" in md.text and "**Note:** a note" in md.text
    rows = list(csv.reader(io.StringIO(client.get(f"/api/documents/{d['id']}/highlights/export?format=csv", headers=auth).content.decode("utf-8-sig"))))
    assert rows[0] == ["chapter", "text", "category", "styles", "note", "pinned"]
    cells = [c for r in rows[1:] for c in r]
    assert not any(c.startswith(("=", "+", "-", "@")) for c in cells) and any(c.startswith("'=HYPERLINK") for c in cells) and "'+cmd" in cells
    assert client.get(f"/api/documents/{d['id']}/highlights/export?format=pdf", headers=auth).status_code == 422


def test_study_cards_export_for_anki_and_csv(client):
    auth = _register(client, "exp2@example.com")
    client.post("/api/study/cards", headers=auth, json={"front": "Line one\nline two", "back": "Tab\there"})
    client.post("/api/study/cards", headers=auth, json={"front": "=SUM(A1)", "back": "b"})
    anki = client.get("/api/study/export", headers=auth).text.splitlines()
    assert anki[:3] == ["#separator:tab", "#html:true", "#columns:Front\tBack\tTags"]
    assert anki[3] == "Line one<br>line two\tTab here\treadvibe" and len(anki) == 5  # embedded newline/tab can't corrupt the format
    csv_rows = list(csv.reader(io.StringIO(client.get("/api/study/export?format=csv", headers=auth).content.decode("utf-8-sig"))))
    assert csv_rows[0][:2] == ["front", "back"] and csv_rows[2][0] == "'=SUM(A1)"
    assert client.get("/api/study/export").status_code == 401
