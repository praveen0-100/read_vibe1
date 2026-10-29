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
from . import languages, speechplan

log = logging.getLogger("readvibe.tts")

try:  # optional dependency: the API still works (with the browser's voices) if it is missing
    import edge_tts
except ImportError:  # pragma: no cover
    edge_tts = None

MAX_CHARS = 1500
DEFAULT_VOICE = "edge:en-US-AvaMultilingualNeural"
NARRATION_STYLE = "Read aloud like a warm, expressive audiobook narrator: natural pacing, gentle emphasis on key ideas, clear diction."

# How a line should *sound*: (rate %, pitch Hz, volume %) relative to the voice's normal delivery. Stage directions such as
# "[in fright]" or "[at the peak of his fury]" are classified into one of these and acted, not read out.
PRESETS: dict[str, tuple[int, int, int]] = {
    "neutral": (0, 0, 0),
    "warm": (-3, 1, 0),
    "excited": (8, 5, 5),
    "serious": (-8, -3, 0),
    "curious": (2, 4, 0),
    "playful": (6, 4, 3),
    "angry": (8, 3, 15),
    "fright": (14, 8, -5),
    "surprise": (4, 7, 5),
    "sad": (-12, -4, -15),
    "whisper": (-10, -2, -35),
    "gentle": (-6, 1, -8),
    "sarcastic": (-4, -5, 0),
    "hesitant": (-8, 0, -5),
    "urgent": (15, 2, 8),
    "solemn": (-14, -3, -3),
}
EMOTIONS = tuple(PRESETS)
_FEELING = {  # for engines that take natural-language direction
    "warm": "warmly", "excited": "with excitement", "serious": "seriously", "curious": "with curiosity", "playful": "playfully",
    "angry": "with sharp, controlled anger", "fright": "in fright, quickly and breathlessly", "surprise": "with astonishment",
    "sad": "sadly, with a heavy voice", "whisper": "in a near whisper", "gentle": "tenderly", "sarcastic": "with dry sarcasm",
    "hesitant": "hesitantly", "urgent": "urgently", "solemn": "solemnly, slowly",
}


def prosody(text: str, emotion: str | None = None, shift: int = 0, delta: tuple[int, int, int] = (0, 0, 0)) -> tuple[str, str, str]:
    """(rate, pitch, volume) strings for edge-tts. Emotion sets the base; the sentence's own punctuation adds the small
    natural lifts a person gives a question or an exclamation; `shift` (Hz) keeps characters apart."""
    rate, pitch, vol = PRESETS.get(emotion or "neutral", PRESETS["neutral"])
    rate, pitch, vol = rate + delta[0], pitch + delta[1], vol + delta[2]  # pace / energy / articulation
    stripped = text.rstrip(" \"”’)")
    if stripped.endswith("?"):
        pitch += 3
    elif stripped.endswith("!"):
        rate += 4
        vol += 8
    if len(text) > 150:
        rate -= 3  # room to breathe on long sentences
    rate = max(-40, min(40, rate))
    pitch = max(-30, min(30, pitch + shift))
    vol = max(-50, min(30, vol))
    return f"{rate:+d}%", f"{pitch:+d}Hz", f"{vol:+d}%"

# English voices (Indian accent first). Indian-language voices come from services/languages.py.
_ENGLISH = [
    ("edge:en-IN-NeerjaNeural", "Neerja", "English · India", "Female", "Natural Indian English"),
    ("edge:en-IN-PrabhatNeural", "Prabhat", "English · India", "Male", "Natural Indian English"),
    ("edge:en-US-AvaMultilingualNeural", "Ava", "English · United States", "Female", "Warm · expressive"),
    ("edge:en-US-AndrewMultilingualNeural", "Andrew", "English · United States", "Male", "Warm · conversational"),
    ("edge:en-US-EmmaMultilingualNeural", "Emma", "English · United States", "Female", "Bright · friendly"),
    ("edge:en-US-BrianMultilingualNeural", "Brian", "English · United States", "Male", "Calm · clear"),
    ("edge:en-GB-SoniaNeural", "Sonia", "English · United Kingdom", "Female", "Polished"),
    ("edge:en-GB-RyanNeural", "Ryan", "English · United Kingdom", "Male", "Confident"),
    ("edge:en-AU-NatashaNeural", "Natasha", "English · Australia", "Female", "Friendly"),
    ("edge:en-AU-WilliamMultilingualNeural", "William", "English · Australia", "Male", "Relaxed"),
    ("edge:en-CA-ClaraNeural", "Clara", "English · Canada", "Female", "Clear"),
    ("edge:en-IE-EmilyNeural", "Emily", "English · Ireland", "Female", "Soft"),
]


def _featured() -> list[tuple]:
    """(id, name, group, gender, style, lang) — Southern languages first, then the other Indian languages, then English."""
    out = []
    for lang in languages.LANGUAGES:
        if lang.code == "en":
            continue
        for vid, name, gender in lang.voices:
            out.append((vid, name, f"{lang.name} · {lang.native}", gender, f"Natural {lang.name}", lang.code))
    out += [(*v, "en") for v in _ENGLISH]
    return out


FEATURED = _featured()
OPENAI_VOICES = [
    ("openai:coral", "Coral", "OpenAI · multilingual", "Female", "Warm · expressive"),
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
         "locale": v["Locale"], "gender": v["Gender"], "group": v["Locale"], "lang": v["Locale"][:2]}
        for v in raw if "Neural" in v["ShortName"]
    ]
    _live["at"] = time.time()
    return _live["voices"]


def voices() -> list[dict]:
    featured = {v[0] for v in FEATURED}
    out = [{"id": vid, "name": name, "group": group, "gender": gender, "style": style, "lang": lang, "featured": True}
           for vid, name, group, gender, style, lang in FEATURED if "edge" in providers()]
    if "openai" in providers():
        out += [{"id": vid, "name": name, "group": group, "gender": gender, "style": style, "lang": "multi", "featured": True}
                for vid, name, group, gender, style in OPENAI_VOICES]
    out += [{**v, "featured": False} for v in _live_voices() if v["id"] not in featured]
    return out


# ─── Text prep ────────────────────────────────────────────────────────────────
def _clean(text: str) -> str:
    text = speechplan.sanitize(text)
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
async def _edge(text: str, voice: str, delivery: tuple[str, str, str], shown: str | None = None) -> tuple[bytes, list[list], str]:
    audio = bytearray()
    words: list[tuple[float, float, str]] = []
    rate, pitch, volume = delivery
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, volume=volume, pitch=pitch, boundary="WordBoundary").stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            words.append((chunk["offset"] / 10_000, chunk["duration"] / 10_000, chunk["text"]))
    if not audio:
        raise TTSError("The voice service returned no audio")
    return bytes(audio), _align(shown or text, words), "ms"


def _openai(text: str, voice: str, emotion: str | None = None) -> tuple[bytes, list[list], str]:
    key = get_settings().openai_api_key
    if not key:
        raise TTSError("OpenAI voices need READVIBE_OPENAI_API_KEY")
    r = httpx.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": get_settings().openai_tts_model, "voice": voice, "input": text,
              "instructions": NARRATION_STYLE + (f" Deliver this line {_FEELING[emotion]}." if emotion in _FEELING else ""), "response_format": "mp3"},
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
def _gender_of(voice: str) -> str | None:
    for lang in languages.LANGUAGES:
        for vid, _name, gender in lang.voices:
            if vid == voice:
                return gender
    return None


def _render(provider: str, name: str, shown: str, emotion: str, shift: int, delta: tuple[int, int, int],
            glossary: dict[str, str] | None) -> tuple[bytes, list[list], str]:
    """One same-language run → (audio, word timings positioned in `shown`, timing unit). Cached on disk."""
    spoken = speechplan.speakable(speechplan.apply_glossary(shown, glossary))   # respellings and plain pauses reach the engine; the transcript stays as written
    cache_dir = get_settings().storage_dir / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{provider}|{name}|{emotion}|{shift}|{delta}|{shown}|{spoken}".encode()).hexdigest()
    audio_path, meta_path = cache_dir / f"{key}.mp3", cache_dir / f"{key}.json"
    if audio_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text("utf-8"))
        return audio_path.read_bytes(), meta["words"], meta["timing"]
    try:
        if provider == "edge":
            audio, words, timing = asyncio.run(_edge(spoken, name, prosody(spoken, emotion, shift, delta), *([shown] if shown != spoken else [])))
        else:
            audio, words, timing = _openai(spoken, name, emotion)
    except TTSError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("TTS failed (%s/%s): %s", provider, name, exc)
        raise TTSError("The voice service is unavailable right now") from exc
    problem = speechplan.check_audio(audio)
    if problem:
        raise TTSError(problem)
    audio_path.write_bytes(audio)
    meta_path.write_text(json.dumps({"words": words, "timing": timing}), "utf-8")
    return audio, words, timing


def synthesize(text: str, voice: str | None = None, emotion: str | None = None, pitch_shift: int = 0, *,
               pace: str | None = None, energy: str | None = None, articulation: str | None = None,
               language: str | None = None, glossary: dict[str, str] | None = None, natural: bool = False,
               position: str | None = None) -> dict:
    """Voice `text` per the universal multilingual TTS contract.

    The wording is never altered. Language comes from `language` when given, else from the text itself run by run (so
    code-switched text keeps each language's own voice). Anything the engine cannot honour is reported in `notes`."""
    text = _clean(text)
    emotion = speechplan.EMOTION_ALIASES.get((emotion or "").lower(), emotion)
    emotion = emotion if emotion in PRESETS else "neutral"
    pitch_shift = max(-20, min(20, int(pitch_shift or 0)))
    delta = speechplan.style(pace, energy, articulation)
    if natural:  # per-sentence human variation (see speechplan.human_delta)
        h = speechplan.human_delta(text, position if position in speechplan.POSITIONS else None)
        delta = (delta[0] + h[0], delta[1] + h[1], delta[2] + h[2])
    voice = voice or DEFAULT_VOICE
    provider, _, name = voice.partition(":")
    if not name:
        provider, name = "edge", voice
    if provider not in providers():
        raise TTSError(f"Voice provider “{provider}” isn’t available on this server")
    voice = f"{provider}:{name}"
    notes = speechplan.review_flags(text)

    if speechplan.voice_lang(voice) is None:  # multilingual voice: one pass, the engine handles the languages itself
        lang = (language or languages.detect(text)).lower()[:2]
        plan = [(speechplan.Run(text, lang), voice)]
    else:
        lang = (language or "").lower()[:2] or None
        pieces = [speechplan.Run(text, lang)] if lang else speechplan.runs(text)
        plan = []
        for run in pieces:
            use, note = speechplan.resolve_voice(voice, run.lang, _gender_of(voice))
            if note and note not in notes:
                notes.append(note)
            plan.append((run, use))
        lang = lang or pieces[0].lang

    audio, words, timing, cursor, offset_ms = b"", [], "ms", 0, 0.0
    for run, use in plan:
        prov, _, nm = use.partition(":")
        a, w, t = _render(prov, nm, run.text, emotion, pitch_shift, delta, glossary)
        at = text.find(run.text, cursor)
        at = cursor if at < 0 else at
        if len(plan) == 1:
            audio, words, timing = a, w, t
        else:  # join runs: shift this run's char offsets and (millisecond) times past the previous ones
            audio += a
            words += [[c + at, ln, s + offset_ms, d] for c, ln, s, d in w]
            if w:
                offset_ms = w[-1][2] + offset_ms + w[-1][3] + 120
        cursor = at + len(run.text)
    if len(plan) > 1:
        notes.append("Language changes inside this text were voiced by separate language voices; word timings across the joins are approximate.")
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "voice": plan[0][1], "words": words, "timing": timing,
            "language": lang, "segments": [{"text": r.text, "language": r.lang, "voice": v} for r, v in plan], "notes": notes}
