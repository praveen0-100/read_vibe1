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


# ─── Whole-text translation for the reader & transcripts ─────────────────────────────────────────────────────────

_LLM_SYSTEM = (
    "You are a professional literary translator. Translate every item into the requested language, keeping its meaning, tone "
    "and paragraph breaks. Keep names, numbers and markdown markers such as '# ' exactly as they are. Do not add, explain or "
    "omit anything. Return exactly one translation per input item, in the same order."
)
_LLM_SCHEMA = {
    "type": "object",
    "properties": {"translations": {"type": "array", "items": {"type": "string"}}},
    "required": ["translations"],
    "additionalProperties": False,
}


def _llm_batch(texts: list[str], target: str, source: str) -> list[str]:
    from . import llm

    lang = languages.get(target)
    src = languages.get(source)
    prompt = (f"Translate these {len(texts)} items from {src.name} into {lang.name} ({lang.native}). "
              "Answer as JSON {\"translations\": [...]} with the same number of items.\n\n" + json.dumps(texts, ensure_ascii=False))
    out = llm.complete_json(_LLM_SYSTEM, prompt, _LLM_SCHEMA, max_tokens=8000).get("translations", [])
    if len(out) != len(texts):
        raise llm.LLMUnavailable("Claude returned the wrong number of translations")
    return [str(t).strip() for t in out]


def translate_texts(texts: list[str], target: str, source: str = "en") -> tuple[list[str | None], str, str | None]:
    """Translate each text. Returns (translations, engine, note). An item that could not be translated is None.

    Claude is used when a key is configured (best quality, whole paragraphs in one call); otherwise the free providers,
    which have a daily allowance — then `note` explains what was left untranslated.
    """
    from . import llm

    clean = [" ".join((t or "").split()) for t in texts]
    result: list[str | None] = [None] * len(clean)
    todo: list[int] = []
    for i, t in enumerate(clean):
        if not t or source == target:
            result[i] = t
            continue
        cached = _cache_file(source, target, t)
        if cached.exists():
            result[i] = json.loads(cached.read_text("utf-8"))["t"]
        else:
            todo.append(i)
    engine = "cache" if not todo else "free"

    if todo and llm.available():
        try:
            for start in range(0, len(todo), 12):
                idx = todo[start:start + 12]
                for i, out in zip(idx, _llm_batch([clean[i] for i in idx], target, source)):
                    result[i] = out
                    _cache_file(source, target, clean[i]).write_text(json.dumps({"t": out}, ensure_ascii=False), "utf-8")
            return result, "claude", None
        except llm.LLMUnavailable as exc:
            log.warning("Claude translation failed, using the free translator: %s", exc)
            todo = [i for i in todo if result[i] is None]

    quota = False
    failure = None

    def one(i: int) -> None:
        nonlocal quota, failure
        try:
            result[i] = translate_one(clean[i], target, source)
        except TranslateError as exc:
            quota = quota or exc.quota
            failure = str(exc)

    if todo:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(one, todo))
    missing = sum(1 for i in todo if result[i] is None)
    note = None
    if missing:
        note = ("The free translation limit for today is used up, so the rest stays in the original language. "
                "Try again tomorrow, or set READVIBE_TRANSLATE_EMAIL / an Anthropic key on the server for more."
                if quota else f"{missing} passage(s) could not be translated: {failure}")
    return result, engine, note
