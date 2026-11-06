"""Stacked annotation marks, pins, Look Up (dictionary + Wikipedia), extraction reports and the outline."""
import httpx
import pytest

from app.seed import FOCUSED_READING
from app.services import lookup


def _doc(client, auth, title="Annotate"):
    return client.post("/api/documents/text", headers=auth, json={"title": title, "content": FOCUSED_READING}).json()


# ─── annotations ──────────────────────────────────────────────────────────────
def test_marks_stack_and_round_trip(client, auth):
    d = _doc(client, auth)
    r = client.post(f"/api/documents/{d['id']}/highlights", headers=auth,
                    json={"chapter_index": 0, "text": "deep focus", "marks": {"highlight": "blue", "underline": "red", "outline": "default"}})
    assert r.status_code == 201
    h = r.json()
    assert h["marks"] == {"highlight": "blue", "underline": "red", "outline": "default"} and h["pinned"] is False
    got = client.get(f"/api/documents/{d['id']}/highlights", headers=auth).json()
    assert got[0]["marks"]["underline"] == "red"


def test_marks_can_be_changed_removed_and_pinned(client, auth):
    d = _doc(client, auth)
    h = client.post(f"/api/documents/{d['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": "x marks", "marks": {"highlight": "yellow", "underline": "teal"}}).json()
    upd = client.patch(f"/api/documents/highlights/{h['id']}", headers=auth, json={"marks": {"highlight": "pink", "underline": None}, "pinned": True}).json()
    assert upd["marks"] == {"highlight": "pink"} and upd["pinned"] is True  # null removes just that style
    assert client.patch(f"/api/documents/highlights/{h['id']}", headers=auth, json={"note": "n"}).json()["marks"] == {"highlight": "pink"}  # untouched when absent


def test_marks_reject_unknown_styles_and_colours(client, auth):
    d = _doc(client, auth)
    url = f"/api/documents/{d['id']}/highlights"
    assert client.post(url, headers=auth, json={"chapter_index": 0, "text": "a", "marks": {"highlight": "chartreuse"}}).status_code == 422
    assert client.post(url, headers=auth, json={"chapter_index": 0, "text": "a", "marks": {"sparkle": "red"}}).status_code == 422
    assert client.post(url, headers=auth, json={"chapter_index": 0, "text": "a", "marks": {"highlight": "red"}}).status_code == 422  # red is a line colour only


def test_existing_category_highlights_still_work(client, auth):
    d = _doc(client, auth)
    h = client.post(f"/api/documents/{d['id']}/highlights", headers=auth, json={"chapter_index": 0, "text": "legacy", "category": "Exam"}).json()
    assert h["category"] == "Exam" and h["marks"] == {}


# ─── reports + outline ────────────────────────────────────────────────────────
def test_report_extraction_error(client, auth, demo):
    d = _doc(client, auth)
    ok = client.post(f"/api/documents/{d['id']}/reports", headers=auth, json={"chapter_index": 0, "text": "teh", "kind": "typo", "comment": "should be the"})
    assert ok.status_code == 201 and ok.json()["kind"] == "typo"
    assert client.post(f"/api/documents/{d['id']}/reports", headers=auth, json={"chapter_index": 0, "kind": "bogus"}).status_code == 422
    assert client.post(f"/api/documents/{d['id']}/reports", headers=demo, json={"chapter_index": 0}).status_code == 404


def test_outline_offsets_are_cumulative(client, auth):
    d = _doc(client, auth)
    out = client.get(f"/api/documents/{d['id']}/outline", headers=auth).json()
    items = out["items"]
    assert items and items[0]["start_offset"] == 0
    for a, b in zip(items, items[1:]):
        assert b["start_offset"] == a["start_offset"] + a["chars"]
    assert out["total_chars"] == items[-1]["start_offset"] + items[-1]["chars"]


# ─── Look Up ──────────────────────────────────────────────────────────────────
def _transport(calls):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        url = str(request.url)
        if "dictionaryapi.dev" in url:
            if url.endswith("/snippet"):
                return httpx.Response(200, json=[{"word": "snippet", "phonetic": "/ˈsnɪpɪt/", "phonetics": [{"audio": "https://x/a.mp3"}],
                                                  "meanings": [{"partOfSpeech": "noun", "definitions": [{"definition": "a small piece"}]}]}])
            return httpx.Response(404, json={"title": "No Definitions Found"})
        if "wikipedia.org" in url:
            return httpx.Response(200, json={"title": "Snippet", "extract": "A snippet is a short piece.", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Snippet"}}})
        return httpx.Response(500)
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _clear_lookup_cache():
    lookup._cache.clear()
    yield
    lookup._cache.clear()


def test_lookup_returns_dictionary_and_wikipedia_then_caches():
    calls: list[str] = []
    c = _transport(calls)
    first = lookup.lookup("Snippet", client=c)
    assert first["dictionary"]["phonetic"] == "/ˈsnɪpɪt/" and first["dictionary"]["meanings"][0]["defs"] == ["a small piece"]
    assert first["wikipedia"]["url"].endswith("/Snippet") and first["cached"] is False
    n = len(calls)
    again = lookup.lookup("snippet", client=c)
    assert again["cached"] is True and len(calls) == n  # case-insensitive cache hit, no network


def test_lookup_skips_dictionary_for_phrases_and_other_languages():
    calls: list[str] = []
    c = _transport(calls)
    phrase = lookup.lookup("a rather long selected phrase", client=c)
    assert phrase["dictionary_skipped"] is True and not any("dictionaryapi" in u for u in calls)
    lookup.lookup("Snippet", lang="ta", client=c)
    assert not any("dictionaryapi" in u for u in calls[-2:]) and any("ta.wikipedia.org" in u for u in calls)


def test_lookup_degrades_per_section_and_never_caches_failures():
    def handler(request):
        if "wikipedia" in str(request.url):
            raise httpx.ConnectError("down")
        return httpx.Response(404)

    c = httpx.Client(transport=httpx.MockTransport(handler))
    out = lookup.lookup("word", client=c)
    assert out["wikipedia"] is None and out["errors"] == ["wikipedia"]
    assert ("word", "en") not in lookup._cache


def test_lookup_endpoint_requires_auth_and_validates(client, auth, monkeypatch):
    assert client.get("/api/lookup", params={"term": "x"}).status_code == 401
    monkeypatch.setattr(lookup, "lookup", lambda term, lang="en", **_: {"term": term, "language": lang, "dictionary": None, "wikipedia": None})
    assert client.get("/api/lookup", headers=auth, params={"term": "  “Snippet,” ", "lang": "en"}).json()["term"] == "Snippet"
    assert client.get("/api/lookup", headers=auth, params={"term": "..."}).status_code == 422
