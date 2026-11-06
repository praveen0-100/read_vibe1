"""Server-side listening state (queue + playlists), the Source → Artifact view, and job cancellation."""
from app.database import SessionLocal
from app.models import Audiobook, Job
from app.seed import FOCUSED_READING

QUEUE = {"queue": [{"id": "b1", "title": "One"}, {"id": "b2#3", "key": "b2#3", "title": "Two", "chapter": 3}], "history": [], "shuffle": True, "repeat": "all"}
LISTS = [{"id": "pl_1", "name": "Study", "ids": ["b1", "b2", "b1"], "created": 1}]


def _put(client, auth, ts, queue=QUEUE, lists=LISTS):
    return client.put("/api/playback/state", headers=auth, json={"queue": queue, "playlists": lists, "client_updated_at": ts})


def test_state_requires_auth(client):
    assert client.get("/api/playback/state").status_code == 401
    assert client.put("/api/playback/state", json={"client_updated_at": 1}).status_code == 401


def test_queue_and_playlists_round_trip_and_survive_reload(client, auth):
    assert client.get("/api/playback/state", headers=auth).json()["queue"] == {}
    r = _put(client, auth, 1000)
    assert r.status_code == 200 and r.json()["applied"] is True
    got = client.get("/api/playback/state", headers=auth).json()
    assert [q["id"] for q in got["queue"]["queue"]] == ["b1", "b2#3"]
    assert got["queue"]["shuffle"] is True and got["queue"]["repeat"] == "all"
    # order is preserved and duplicate playlist members are collapsed
    assert got["playlists"][0]["ids"] == ["b1", "b2"]


def test_stale_write_does_not_clobber_newer_state(client, auth):
    _put(client, auth, 5000, queue={"queue": [{"id": "new"}]}, lists=[])
    stale = _put(client, auth, 4000, queue={"queue": [{"id": "old"}]}, lists=[])
    assert stale.json()["applied"] is False
    assert stale.json()["queue"]["queue"][0]["id"] == "new"
    assert client.get("/api/playback/state", headers=auth).json()["queue"]["queue"][0]["id"] == "new"


def test_state_is_sanitised(client, auth):
    junk = {"queue": [{"id": 5}, "x", {"id": "ok"}], "history": [], "repeat": "bogus"}
    out = _put(client, auth, 9000, queue=junk, lists=[{"name": "no id"}, "x"]).json()
    assert [q["id"] for q in out["queue"]["queue"]] == ["ok"]
    assert out["queue"]["repeat"] == "off" and out["playlists"] == []


def test_state_is_private_per_user(client, auth, demo):
    _put(client, auth, 12000, queue={"queue": [{"id": "mine"}]})
    assert client.get("/api/playback/state", headers=demo).json()["queue"].get("queue", []) != [{"id": "mine"}]


def test_source_artifacts_lists_everything_made_from_one_upload(client, auth):
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Source", "content": FOCUSED_READING}).json()
    book = client.post("/api/audio/audiobooks", headers=auth, json={"document_id": doc["id"], "tone": "Regular"}).json()["audiobook"]
    out = client.get(f"/api/sources/{doc['id']}/artifacts", headers=auth).json()
    types = [a["type"] for a in out["artifacts"]]
    assert types[0] == "reader" and "audiobook" in types
    ab = next(a for a in out["artifacts"] if a["type"] == "audiobook")
    assert ab["id"] == book["id"] and ab["source"]["id"] == doc["id"] and ab["configuration"]["tone"] == "Regular"
    assert client.get("/api/sources/nope/artifacts", headers=auth).status_code == 404


def test_cancel_job_never_ends_ready(client, auth):
    doc = client.post("/api/documents/text", headers=auth, json={"title": "Cancel me", "content": FOCUSED_READING}).json()
    with SessionLocal() as db:
        book = Audiobook(owner_id=_owner(db, doc["id"]), document_id=doc["id"], title="x", status="processing", script=[])
        db.add(book)
        db.commit()
        job = Job(owner_id=book.owner_id, kind="audiobook", title="x", status="processing", ref_id=book.id)
        db.add(job)
        db.commit()
        job_id, book_id = job.id, book.id
    r = client.post(f"/api/jobs/{job_id}/cancel", headers=auth)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.get(f"/api/audio/audiobooks/{book_id}", headers=auth).json()["status"] == "cancelled"
    assert client.post(f"/api/jobs/{job_id}/cancel", headers=auth).status_code == 409  # not cancellable twice


def _owner(db, doc_id):
    from app.models import Document
    return db.get(Document, doc_id).owner_id
