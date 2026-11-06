"""Look Up: a word's dictionary entry and a Wikipedia summary, fetched server-side and cached.

Both providers are free and keyless. Fetching through the API avoids browser CORS problems and lets one cache serve every
reader. Failures degrade per section (a missing dictionary entry never hides the Wikipedia summary).
"""
from __future__ import annotations

import re
import time
from urllib.parse import quote

import httpx

TTL_SECONDS = 7 * 24 * 3600
MAX_CACHE = 2000
DICTIONARY_LANGS = {"en"}  # dictionaryapi.dev has solid coverage for English; other languages get Wikipedia only
_cache: dict[tuple[str, str], tuple[float, dict]] = {}


def clean_term(term: str) -> str:
    return re.sub(r"\s+", " ", term).strip(" \t\r\n.,;:!?\"'()[]{}“”‘’")[:80]


def _dictionary(term: str, client: httpx.Client) -> dict | None:
    r = client.get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{quote(term.lower())}")
    if r.status_code != 200:
        return None
    entries = r.json()
    if not isinstance(entries, list) or not entries:
        return None
    first = entries[0]
    phonetic = first.get("phonetic") or next((p.get("text") for p in first.get("phonetics", []) if p.get("text")), None)
    audio = next((p.get("audio") for p in first.get("phonetics", []) if p.get("audio")), None)
    meanings = []
    for m in first.get("meanings", [])[:4]:
        defs = [d.get("definition") for d in m.get("definitions", [])[:3] if d.get("definition")]
        if defs:
            meanings.append({"pos": m.get("partOfSpeech", ""), "defs": defs})
    return {"word": first.get("word", term), "phonetic": phonetic, "audio": audio, "meanings": meanings} if meanings else None


def _wikipedia(term: str, lang: str, client: httpx.Client) -> dict | None:
    r = client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(term.replace(' ', '_'))}", params={"redirect": "true"})
    if r.status_code != 200:
        return None
    data = r.json()
    if data.get("type") == "disambiguation" or not data.get("extract"):
        return None
    return {"title": data.get("title", term), "extract": data["extract"][:1200], "url": (data.get("content_urls", {}).get("desktop", {}) or {}).get("page")}


def lookup(term: str, lang: str = "en", client: httpx.Client | None = None, now=time.time) -> dict:
    term = clean_term(term)
    lang = lang if re.fullmatch(r"[a-z]{2,3}", lang or "") else "en"
    key = (term.lower(), lang)
    hit = _cache.get(key)
    if hit and now() - hit[0] < TTL_SECONDS:
        return {**hit[1], "cached": True}

    words = len(term.split())
    own = client is None
    client = client or httpx.Client(timeout=6.0, headers={"User-Agent": "ReadVibe/3 (reading app)"}, follow_redirects=True)
    result: dict = {"term": term, "language": lang, "dictionary": None, "wikipedia": None, "dictionary_skipped": False, "errors": []}
    try:
        if words <= 3 and lang in DICTIONARY_LANGS:
            try:
                result["dictionary"] = _dictionary(term, client)
            except httpx.HTTPError:
                result["errors"].append("dictionary")
        else:
            result["dictionary_skipped"] = True  # a phrase or a non-English page: definitions would be wrong or absent
        try:
            result["wikipedia"] = _wikipedia(term, lang, client)
        except httpx.HTTPError:
            result["errors"].append("wikipedia")
    finally:
        if own:
            client.close()

    if not result["errors"]:  # never cache a failure: the next try may well work
        if len(_cache) >= MAX_CACHE:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (now(), result)
    return {**result, "cached": False}
