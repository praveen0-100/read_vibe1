"""Artwork: EPUB-embedded covers, custom uploads (validated by content), fallbacks and ownership."""
import io
import zipfile

from app.seed import FOCUSED_READING

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _epub(cover: bytes | None) -> bytes:
    buf = io.BytesIO()
    body = "<html><body><h1>Chapter One</h1><p>" + ("A long enough paragraph of readable words to pass the filter. " * 10) + "</p></body></html>"
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        cover_item = '<item id="cov" href="images/cover.png" media-type="image/png" properties="cover-image"/>' if cover else ""
        z.writestr("OEBPS/content.opf", f'<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Covered</dc:title><dc:creator>Au Thor</dc:creator></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>{cover_item}</manifest><spine><itemref idref="c1"/></spine></package>')
        z.writestr("OEBPS/c1.xhtml", body)
        if cover:
            z.writestr("OEBPS/images/cover.png", cover)
    return buf.getvalue()


def _doc(client, auth, title="Art"):
    return client.post("/api/documents/text", headers=auth, json={"title": title, "content": FOCUSED_READING}).json()


def test_no_cover_falls_back_to_404_and_flag_is_false(client, auth):
    doc = _doc(client, auth)
    assert doc["has_cover"] is False
    assert client.get(f"/api/documents/{doc['id']}/cover", headers=auth).status_code == 404


def test_custom_cover_upload_round_trip_and_removal(client, auth):
    doc = _doc(client, auth)
    r = client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("c.png", PNG, "image/png")})
    assert r.status_code == 200 and r.json()["has_cover"] is True
    got = client.get(f"/api/documents/{doc['id']}/cover", headers=auth)
    assert got.status_code == 200 and got.headers["content-type"] == "image/png" and got.content == PNG
    # replacing with a different type swaps the stored file
    assert client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("c.jpg", JPG, "image/jpeg")}).status_code == 200
    assert client.get(f"/api/documents/{doc['id']}/cover", headers=auth).headers["content-type"] == "image/jpeg"
    assert client.delete(f"/api/documents/{doc['id']}/cover", headers=auth).status_code == 204
    assert client.get(f"/api/documents/{doc['id']}", headers=auth).json()["has_cover"] is False


def test_cover_rejects_non_images_and_oversize(client, auth):
    doc = _doc(client, auth)
    bad = client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("evil.png", b"<script>alert(1)</script>", "image/png")})
    assert bad.status_code == 415
    big = client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("big.png", PNG + b"\x00" * (5 * 1024 * 1024), "image/png")})
    assert big.status_code == 413
    assert client.get(f"/api/documents/{doc['id']}", headers=auth).json()["has_cover"] is False


def test_cover_is_private_to_its_owner(client, auth, demo):
    doc = _doc(client, auth)
    client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("c.png", PNG, "image/png")})
    assert client.get(f"/api/documents/{doc['id']}/cover", headers=demo).status_code == 404
    assert client.put(f"/api/documents/{doc['id']}/cover", headers=demo, files={"file": ("c.png", PNG, "image/png")}).status_code == 404


def test_epub_embedded_cover_is_extracted_on_import(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("covered.epub", _epub(PNG), "application/epub+zip")})
    assert r.status_code == 202, r.text
    doc_id = r.json()["document"]["id"]
    doc = client.get(f"/api/documents/{doc_id}", headers=auth).json()
    assert doc["status"] == "ready" and doc["has_cover"] is True
    assert client.get(f"/api/documents/{doc_id}/cover", headers=auth).content == PNG


def test_epub_without_cover_imports_cleanly(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("plain.epub", _epub(None), "application/epub+zip")})
    doc = client.get(f"/api/documents/{r.json()['document']['id']}", headers=auth).json()
    assert doc["status"] == "ready" and doc["has_cover"] is False


def test_audiobook_reports_its_sources_cover(client, auth):
    doc = _doc(client, auth, "Audio art")
    client.put(f"/api/documents/{doc['id']}/cover", headers=auth, files={"file": ("c.png", PNG, "image/png")})
    client.post("/api/audio/audiobooks", headers=auth, json={"document_id": doc["id"], "tone": "Regular"})
    books = [b for b in client.get("/api/audio/audiobooks", headers=auth).json() if b["document_id"] == doc["id"]]
    assert books and books[0]["document_has_cover"] is True
