"""Natural-sounding speech for read-aloud: neural cloud voices with word timings.

Providers (a voice id is `<provider>:<voice>`):
  * edge   — Microsoft neural voices through the `edge-tts` package. No API key. Returns exact word timings.
  * openai — OpenAI speech models (needs READVIBE_OPENAI_API_KEY). Supports narration-style instructions;
             word timings are estimated from character counts.
Synthesised segments are cached on disk, so re-reading a passage costs nothing.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import time

import httpx

from ..config import get_settings

log = logging.getLogger("readvibe.tts")

try:  # optional dependency: the API still works (with the browser's voices) if it is missing
    import edge_tts
except ImportError:  # pragma: no cover
    edge_tts = None

MAX_CHARS = 1500
DEFAULT_VOICE = "edge:en-US-AvaMultilingualNeural"
NARRATION_STYLE = "Read aloud like a warm, expressive audiobook narrator: natural pacing, gentle emphasis on key ideas, clear diction."

# A hand-picked set of the most natural voices (shown first, grouped by accent). The full catalogue is appended live.
FEATURED = [
    ("edge:en-US-AvaMultilingualNeural", "Ava", "United States", "Female", "Warm · expressive"),
    ("edge:en-US-AndrewMultilingualNeural", "Andrew", "United States", "Male", "Warm · conversational"),
    ("edge:en-US-EmmaMultilingualNeural", "Emma", "United States", "Female", "Bright · friendly"),
    ("edge:en-US-BrianMultilingualNeural", "Brian", "United States", "Male", "Calm · clear"),
    ("edge:en-GB-SoniaNeural", "Sonia", "United Kingdom", "Female", "Polished"),
    ("edge:en-GB-RyanNeural", "Ryan", "United Kingdom", "Male", "Confident"),
    ("edge:en-IN-NeerjaNeural", "Neerja", "India", "Female", "Natural Indian English"),
    ("edge:en-IN-PrabhatNeural", "Prabhat", "India", "Male", "Natural Indian English"),
    ("edge:en-AU-NatashaNeural", "Natasha", "Australia", "Female", "Friendly"),
    ("edge:en-AU-WilliamMultilingualNeural", "William", "Australia", "Male", "Relaxed"),
    ("edge:en-CA-ClaraNeural", "Clara", "Canada", "Female", "Clear"),
    ("edge:en-IE-EmilyNeural", "Emily", "Ireland", "Female", "Soft"),
    ("edge:ta-IN-PallaviNeural", "Pallavi", "Tamil (India)", "Female", "Tamil"),
    ("edge:hi-IN-SwaraNeural", "Swara", "Hindi (India)", "Female", "Hindi"),
]
OPENAI_VOICES = [
    ("openai:coral", "Coral", "OpenAI", "Female", "Warm · expressive"),
    ("openai:alloy", "Alloy", "OpenAI", "Neutral", "Balanced"),
    ("openai:sage", "Sage", "OpenAI", "Female", "Calm"),
    ("openai:ash", "Ash", "OpenAI", "Male", "Grounded"),
    ("openai:onyx", "Onyx", "OpenAI", "Male", "Deep"),
]


class TTSError(Exception):
    pass


def providers() -> list[str]:
    out = []
    if edge_tts is not None:
        out.append("edge")
    if get_settings().openai_api_key:
        out.append("openai")
    return out


def available() -> bool:
    return bool(providers())


_live: dict = {"at": 0.0, "voices": []}


def _live_voices() -> list[dict]:
    """Every Microsoft neural voice (cached for a day); empty when offline."""
    if edge_tts is None:
        return []
    if time.time() - _live["at"] < 86400 and _live["voices"]:
        return _live["voices"]
    try:
        raw = asyncio.run(edge_tts.list_voices())
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not list neural voices: %s", exc)
        return _live["voices"]
    _live["voices"] = [
        {"id": f"edge:{v['ShortName']}", "name": v["ShortName"].split("-", 2)[-1].replace("Neural", "").replace("Multilingual", ""),
         "locale": v["Locale"], "gender": v["Gender"], "group": v["Locale"]}
        for v in raw if "Neural" in v["ShortName"]
    ]
    _live["at"] = time.time()
    return _live["voices"]


def voices() -> list[dict]:
    featured = {vid for vid, *_ in FEATURED}
    out = [{"id": vid, "name": name, "group": group, "gender": gender, "style": style, "featured": True}
           for vid, name, group, gender, style in FEATURED if "edge" in providers()]
    if "openai" in providers():
        out += [{"id": vid, "name": name, "group": group, "gender": gender, "style": style, "featured": True}
                for vid, name, group, gender, style in OPENAI_VOICES]
    out += [{**v, "featured": False} for v in _live_voices() if v["id"] not in featured]
    return out


# ─── Text prep ────────────────────────────────────────────────────────────────
def _clean(text: str) -> str:
    text = re.sub(r"[*_`#]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        raise TTSError("Nothing to read")
    if len(text) > MAX_CHARS:
        raise TTSError(f"Text is too long (max {MAX_CHARS} characters per request)")
    return text


def _align(text: str, words: list[tuple[float, float, str]]) -> list[list]:
    """[(start_ms, dur_ms, word)] → [[char_offset, length, start_ms, dur_ms]] positioned in `text`."""
    out, cursor = [], 0
    for start, dur, word in words:
        at = text.find(word, cursor)
        if at < 0:
            continue
        out.append([at, len(word), int(start), int(dur)])
        cursor = at + len(word)
    return out


# ─── Providers ────────────────────────────────────────────────────────────────
async def _edge(text: str, voice: str) -> tuple[bytes, list[list], str]:
    audio = bytearray()
    words: list[tuple[float, float, str]] = []
    async for chunk in edge_tts.Communicate(text, voice, boundary="WordBoundary").stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            words.append((chunk["offset"] / 10_000, chunk["duration"] / 10_000, chunk["text"]))
    if not audio:
        raise TTSError("The voice service returned no audio")
    return bytes(audio), _align(text, words), "ms"


def _openai(text: str, voice: str) -> tuple[bytes, list[list], str]:
    key = get_settings().openai_api_key
    if not key:
        raise TTSError("OpenAI voices need READVIBE_OPENAI_API_KEY")
    r = httpx.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": get_settings().openai_tts_model, "voice": voice, "input": text, "instructions": NARRATION_STYLE, "response_format": "mp3"},
        timeout=60,
    )
    if r.status_code != 200:
        raise TTSError(f"OpenAI speech request failed ({r.status_code})")
    # no timings from the API: spread time over words by length (the client scales it to the real duration)
    spans = [(m.start(), len(m.group()), len(m.group()) + 2) for m in re.finditer(r"\S+", text)]
    total = sum(w for *_, w in spans) or 1
    acc, words = 0, []
    for at, ln, w in spans:
        words.append([at, ln, acc / total, w / total])
        acc += w
    return r.content, words, "fraction"


# ─── Public API ───────────────────────────────────────────────────────────────
def synthesize(text: str, voice: str | None = None) -> dict:
    text = _clean(text)
    voice = voice or DEFAULT_VOICE
    provider, _, name = voice.partition(":")
    if not name:
        provider, name = "edge", voice
    if provider not in providers():
        raise TTSError(f"Voice provider “{provider}” isn’t available on this server")

    cache_dir = get_settings().storage_dir / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{provider}|{name}|{text}".encode()).hexdigest()
    audio_path, meta_path = cache_dir / f"{key}.mp3", cache_dir / f"{key}.json"
    if audio_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text("utf-8"))
        audio = audio_path.read_bytes()
    else:
        try:
            if provider == "edge":
                audio, words, timing = asyncio.run(_edge(text, name))
            else:
                audio, words, timing = _openai(text, name)
        except TTSError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("TTS failed (%s/%s): %s", provider, name, exc)
            raise TTSError("The voice service is unavailable right now") from exc
        meta = {"words": words, "timing": timing}
        audio_path.write_bytes(audio)
        meta_path.write_text(json.dumps(meta), "utf-8")
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "voice": f"{provider}:{name}", **meta}
