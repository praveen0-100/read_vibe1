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


# ─── AI meaning (Groq, or whichever model is configured) ──────────────────────────────────────────────────────────────────
# The dictionary only knows English single words and Wikipedia only knows famous things; the model explains anything: a phrase, a
# name, a word in Tamil, or a word as this particular passage uses it. Short, cached, and always optional.
_AI_MEANING_SCHEMA = {
    "type": "object",
    "properties": {
        "meaning": {"type": "string", "description": "What the term means, in one or two plain sentences"},
        "part_of_speech": {"type": "string", "description": "noun, verb, adjective, idiom, name… (empty if not applicable)"},
        "simple": {"type": "string", "description": "The same idea in the simplest possible words, as if for a ten-year-old"},
        "example": {"type": "string", "description": "One short natural example sentence using the term"},
        "in_context": {"type": "string", "description": "What it means in the given passage (empty when no passage was given)"},
    },
    "required": ["meaning"],
}
_AI_SYSTEM = (
    "You are the dictionary inside ReadVibe, a reading app. Give the meaning of the term the reader selected. Be accurate, brief and "
    "plain. Never invent facts: if the term is not a real word or name, say that in `meaning` and suggest what it may be. "
    "Write in the language named in the request."
)
_ai_cache: dict[tuple, tuple[float, dict]] = {}


def ai_meaning(term: str, lang: str = "en", context: str = "", doc_title: str = "") -> dict | None:
    """A short AI explanation of `term`, or None when no model is available (the caller then shows only the dictionary)."""
    from . import languages, llm  # local: lookup must stay importable without the LLM stack

    term = clean_term(term)
    if not term or not llm.available():
        return None
    context = re.sub(r"\s+", " ", context or "").strip()[:500]
    key = (term.lower(), lang, hash(context))
    hit = _ai_cache.get(key)
    if hit and time.time() - hit[0] < TTL_SECONDS:
        return {**hit[1], "cached": True}
    name = languages.get(lang).name
    prompt = f"Term: “{term}”\nWrite the answer in: {name} ({lang}).\n"
    if context:
        prompt += f"\nPassage where the reader found it{f' (from “{doc_title}”)' if doc_title else ''}:\n<passage>\n{context}\n</passage>\nFill `in_context` with what the term means HERE.\n"
    else:
        prompt += "\nNo passage was given: leave `in_context` empty.\n"
    try:
        data = llm.complete_json(_AI_SYSTEM, prompt, _AI_MEANING_SCHEMA, max_tokens=700, fast=True)
    except llm.LLMUnavailable:
        return None
    out = {k: str(data.get(k) or "").strip() for k in ("meaning", "part_of_speech", "simple", "example", "in_context")}
    if not out["meaning"]:
        return None
    out["engine"] = llm.provider_name()
    if len(_ai_cache) >= MAX_CACHE:
        _ai_cache.pop(next(iter(_ai_cache)))
    _ai_cache[key] = (time.time(), out)
    return {**out, "cached": False}
