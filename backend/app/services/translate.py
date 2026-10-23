"""Free machine translation for any supported language — no API key, no account.

Provider: MyMemory (api.mymemory.translated.net), a public translation API with a free daily allowance (about 5,000
characters a day anonymously, 50,000 with a contact e-mail — set READVIBE_TRANSLATE_EMAIL). Google's unofficial endpoint
is tried as a fallback. Because the allowance is finite the module is built to spend little of it:

  * every sentence is cached on disk forever, so a text is translated once per language;
  * callers translate only what they need (key points, not whole books);
  * results are verified to be in the target script (an answer that came back untranslated is rejected, never spoken);
  * when the allowance is used up a clear TranslateError(quota=True) is raised instead of silently producing English.
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from ..config import get_settings
from . import languages

log = logging.getLogger("readvibe.translate")

MAX_CHARS = 450  # MyMemory accepts at most 500 bytes per request
_HEADERS = {"User-Agent": "Mozilla/5.0 (ReadVibe)"}


class TranslateError(Exception):
    def __init__(self, message: str, quota: bool = False):
        super().__init__(message)
        self.quota = quota


def _cache_file(source: str, target: str, text: str):
    folder = get_settings().storage_dir / "translations"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / (hashlib.sha1(f"{source}>{target}|{text}".encode()).hexdigest() + ".json")


def _in_script(text: str, target: str) -> bool:
    """True when `text` plausibly *is* the target language: Latin-script targets always pass, others need their own script."""
    lang = languages.get(target)
    if lang.code == "en":
        return True
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    own = sum(any(lo <= ord(c) <= hi for lo, hi in lang.script) for c in letters)
    return own / len(letters) >= 0.4


def _mymemory(text: str, source: str, target: str) -> str:
    params = {"q": text, "langpair": f"{source}|{target}"}
    email = get_settings().translate_email
    if email:
        params["de"] = email  # a contact address lifts the free allowance from ~5k to ~50k characters a day
    r = httpx.get("https://api.mymemory.translated.net/get", params=params, headers=_HEADERS, timeout=20)
    try:
        data = r.json()
    except ValueError as exc:
        raise TranslateError("The translation service sent an unreadable answer") from exc
    status = int(data.get("responseStatus") or r.status_code)
    out = html.unescape((data.get("responseData") or {}).get("translatedText") or "")
    if status == 429 or "ALL AVAILABLE FREE TRANSLATIONS" in out.upper() or data.get("quotaFinished"):
        raise TranslateError("The free translation allowance is used up for today", quota=True)
    if status != 200 or not out:
        raise TranslateError(f"Translation failed ({status})")
    return out


def _google(text: str, source: str, target: str) -> str:
    r = httpx.get("https://translate.googleapis.com/translate_a/single",
                  params={"client": "gtx", "sl": source, "tl": target, "dt": "t", "q": text}, headers=_HEADERS, timeout=15)
    if r.status_code != 200:
        raise TranslateError(f"Google answered {r.status_code}", quota=r.status_code == 429)
    try:
        return "".join(seg[0] for seg in r.json()[0] if seg and seg[0])
    except (ValueError, IndexError, TypeError) as exc:
        raise TranslateError("Unreadable answer from Google") from exc


PROVIDERS = (_mymemory, _google)


def translate_one(text: str, target: str, source: str = "en") -> str:
    text = " ".join((text or "").split())
    if not text or source == target:
        return text
    cached = _cache_file(source, target, text)
    if cached.exists():
        return json.loads(cached.read_text("utf-8"))["t"]
    if len(text) > MAX_CHARS:  # cut at a sentence/space so each request is small enough
        cut = max(text.rfind(". ", 0, MAX_CHARS), text.rfind(" ", 0, MAX_CHARS))
        head, tail = text[: cut + 1].strip(), text[cut + 1:].strip()
        return " ".join(p for p in (translate_one(head, target, source), translate_one(tail, target, source)) if p)

    quota = False
    last = "No translation service answered"
    for provider in PROVIDERS:
        for attempt in range(2):
            try:
                out = provider(text, source, target).strip()
            except TranslateError as exc:
                quota = quota or exc.quota
                last = str(exc)
                break  # this provider is unwell: try the next one
            except httpx.HTTPError as exc:
                last = f"Could not reach the translation service ({type(exc).__name__})"
                time.sleep(0.4 * (attempt + 1))
                continue
            if _in_script(out, target) and out.lower() != text.lower():
                cached.write_text(json.dumps({"t": out}, ensure_ascii=False), "utf-8")
                return out
            last = "The service returned the text untranslated"
            break
    raise TranslateError(last, quota=quota)


def translate_many(texts: list[str], target: str, source: str = "en") -> list[str]:
    """Translate in order, a few at a time. Raises TranslateError if any sentence cannot be translated."""
    if not texts:
        return []
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(lambda t: translate_one(t, target, source), texts))
