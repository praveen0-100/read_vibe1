"""Imported catalogue books arrive with their own cover (fetched server-side from a URL the server builds)."""
import httpx

from app.routers import catalog

REAL_CLIENT = httpx.Client  # captured once: each patch must wrap the real client, not the previous patch

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
BOOK_TEXT = "It was a bright cold day in April, and the clocks were striking thirteen. " * 40


def _patch_text(monkeypatch):
    monkeypatch.setattr(catalog, "_fetch", lambda urls: BOOK_TEXT)


def test_gutenberg_import_stores_the_books_cover(client, auth, monkeypatch):
    _patch_text(monkeypatch)
    seen = {}

    def fake_cover(urls):
        seen["urls"] = urls
        return PNG

    monkeypatch.setattr(catalog, "_fetch_cover", fake_cover)
    r = client.post("/api/catalog/import", headers=auth, json={"source": "gutenberg", "id": "1342", "title": "Pride and Prejudice", "author": "Jane Austen"})
    assert r.status_code == 201 and r.json()["has_cover"] is True
    # the server, not the client, decides where the cover comes from
    assert seen["urls"] == ["https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg"]
    got = client.get(f"/api/documents/{r.json()['id']}/cover", headers=auth)
    assert got.status_code == 200 and got.content == PNG and got.headers["content-type"] == "image/png"


def test_archive_import_uses_the_archive_image_service(client, auth, monkeypatch):
    _patch_text(monkeypatch)
    seen = {}
    monkeypatch.setattr(catalog, "_fetch_cover", lambda urls: seen.setdefault("urls", urls) and PNG)
    r = client.post("/api/catalog/import", headers=auth, json={"source": "archive", "id": "some_book_1900", "title": "Some Book", "author": "A. Writer"})
    assert r.status_code == 201 and seen["urls"] == ["https://archive.org/services/img/some_book_1900"]


def test_a_missing_or_broken_cover_never_fails_the_import(client, auth, monkeypatch):
    _patch_text(monkeypatch)
    monkeypatch.setattr(catalog, "_fetch_cover", lambda urls: None)
    r = client.post("/api/catalog/import", headers=auth, json={"source": "gutenberg", "id": "11", "title": "Alice", "author": "Lewis Carroll"})
    assert r.status_code == 201 and r.json()["has_cover"] is False
    monkeypatch.setattr(catalog, "_fetch_cover", lambda urls: b"<html>not an image</html>")  # even if a fetcher misbehaves
    assert client.post("/api/catalog/import", headers=auth, json={"source": "gutenberg", "id": "12", "title": "Alice 2", "author": "Lewis Carroll"}).status_code == 201


def test_cover_fetcher_rejects_non_images_wrong_hosts_and_big_files(monkeypatch):
    def serve(status, body, host="www.gutenberg.org"):
        def handler(request):
            return httpx.Response(status, content=body, request=httpx.Request("GET", f"https://{host}/x"))
        monkeypatch.setattr(catalog.httpx, "Client", lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))

    serve(200, PNG)
    assert catalog._fetch_cover(["https://www.gutenberg.org/x"]) == PNG
    serve(200, b"<script>alert(1)</script>")
    assert catalog._fetch_cover(["https://www.gutenberg.org/x"]) is None       # not an image
    serve(200, PNG + b"\x00" * (4 * 1024 * 1024))
    assert catalog._fetch_cover(["https://www.gutenberg.org/x"]) is None       # over the size cap
    serve(404, b"")
    assert catalog._fetch_cover(["https://www.gutenberg.org/x"]) is None
    serve(200, PNG)
    assert catalog._fetch_cover(["https://evil.example.com/x"]) is None        # a final host outside the allow-list is refused
