"""Free-books catalogue: validation, safe imports, and the static-catalogue fallback (no network needed)."""
import httpx
import pytest
from fastapi import HTTPException

from app.routers import catalog

GUTENBERG_TEXT = (
    "Header junk\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n"
    + ("It was a bright cold day in April, and the clocks were striking thirteen. " * 40)
    + "\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nLicense junk"
)

ROWS = [
    # id, title, author, subjects, shelves, issued, title+author blob, subjects+shelves blob
    (11, "Alice's Adventures in Wonderland", "Carroll, Lewis", "Fantasy", "", "1994-03-01", "alice's adventures in wonderland carroll, lewis", "fantasy children's literature"),
    (1661, "The Adventures of Sherlock Holmes", "Doyle, Arthur Conan", "Detective", "", "1999-11-29", "the adventures of sherlock holmes doyle, arthur conan", "detective crime"),
    (79000, "A Brand New Book", "Writer, Some", "Fiction", "", "2026-10-20", "a brand new book writer, some", "fiction"),
]


@pytest.fixture
def pg_rows(monkeypatch):
    monkeypatch.setitem(catalog._pg, "rows", ROWS)
    monkeypatch.setitem(catalog._pg, "at", 9e12)


def test_catalog_requires_auth(client):
    assert client.get("/api/catalog/new").status_code == 401
    assert client.get("/api/catalog/gutenberg").status_code == 401
    assert client.post("/api/catalog/import", json={"source": "gutenberg", "id": "1", "title": "x"}).status_code == 401


def test_import_rejects_unsafe_ids(client, auth):
    for body in (
        {"source": "archive", "id": "../etc/passwd", "title": "x"},
        {"source": "archive", "id": "a/b", "title": "x"},
        {"source": "gutenberg", "id": "12abc", "title": "x"},
        {"source": "http", "id": "1", "title": "x"},
    ):
        assert client.post("/api/catalog/import", headers=auth, json=body).status_code in (400, 422), body


def test_import_gutenberg_strips_boilerplate(client, auth, monkeypatch):
    monkeypatch.setattr(catalog, "_fetch", lambda urls: GUTENBERG_TEXT)
    r = client.post("/api/catalog/import", headers=auth, json={"source": "gutenberg", "id": "1984", "title": "Test Book", "author": "A. Writer"})
    assert r.status_code == 201, r.text
    doc = client.get(f"/api/documents/{r.json()['id']}", headers=auth).json()
    assert doc["title"] == "Test Book" and doc["status"] == "ready"
    chapter = client.get(f"/api/documents/{doc['id']}/chapters/0", headers=auth).json()
    body = str(chapter)
    assert "bright cold day" in body
    assert "START OF THE PROJECT" not in body and "License junk" not in body


def test_import_too_short_text_is_rejected(client, auth, monkeypatch):
    monkeypatch.setattr(catalog, "_fetch", lambda urls: "tiny")
    r = client.post("/api/catalog/import", headers=auth, json={"source": "archive", "id": "some-id", "title": "Tiny"})
    assert r.status_code == 422


def test_static_catalogue_search_and_new(pg_rows):
    hits = catalog._pg_search({"search": "sherlock"})
    assert [b["id"] for b in hits["results"]] == [1661]
    assert hits["results"][0]["authors"] == [{"name": "Doyle, Arthur Conan"}]
    assert hits["results"][0]["formats"]["image/jpeg"].endswith("/1661/pg1661.cover.medium.jpg")
    assert [b["id"] for b in catalog._pg_search({"sort": "descending"})["results"]] == [79000, 1661, 11]
    assert [b["id"] for b in catalog._pg_search({"topic": "children"})["results"]] == [11]
    assert catalog._pg_search({"search": "nothing-matches-this"})["count"] == 0


def test_static_catalogue_paginates(monkeypatch):
    many = [(i, f"Book {i}", "A", "", "", "", f"book {i} a", "") for i in range(1, 80)]
    monkeypatch.setitem(catalog._pg, "rows", many)
    monkeypatch.setitem(catalog._pg, "at", 9e12)
    p1 = catalog._pg_search({"page": 1})
    p3 = catalog._pg_search({"page": 3})
    assert len(p1["results"]) == 32 and p1["next"]
    assert len(p3["results"]) == 15 and p3["next"] is None


def test_falls_back_when_gutendex_is_down(monkeypatch, pg_rows):
    def boom(*a, **k):
        raise HTTPException(status_code=502, detail="down")

    monkeypatch.setattr(catalog, "_get_json", boom)
    out = catalog._gutendex({"search": "alice"})
    assert out["results"][0]["id"] == 11


def test_warming_up_when_neither_source_is_ready(monkeypatch):
    monkeypatch.setitem(catalog._pg, "rows", None)
    monkeypatch.setitem(catalog._pg, "loading", True)  # a load is "in flight", so no download starts
    with pytest.raises(HTTPException) as err:
        catalog._pg_search({"search": "alice"})
    assert err.value.status_code == 503


def test_get_json_serves_stale_cache_when_upstream_fails(monkeypatch):
    url = "https://example.invalid/feed"
    catalog._cache[url + repr([])] = (0.0, {"stale": True})  # expired entry
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    monkeypatch.setattr(catalog.time, "sleep", lambda s: None)
    assert catalog._get_json(url) == {"stale": True}


def test_slow_gutendex_hits_a_hard_deadline_then_falls_back(monkeypatch, pg_rows):
    import time

    monkeypatch.setattr(catalog, "GUTENDEX_BUDGET", 0.2)
    monkeypatch.setattr(catalog, "_get_json", lambda *a, **k: (time.sleep(2), {"results": [{"id": 1}]})[1])
    start = time.time()
    out = catalog._gutendex({"search": "alice"})
    assert time.time() - start < 1.0
    assert out["results"][0]["id"] == 11  # served from the static catalogue
