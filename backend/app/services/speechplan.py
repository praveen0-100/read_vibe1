"""Speech planning for the universal multilingual TTS contract.

Everything here decides *how* a transcript is voiced without touching *what* is said (transcript fidelity):
  * sanitize        — markup and formatting characters are never spoken
  * runs            — language detection per phrase, so deliberate code-switching keeps each language's own voice
  * style           — pace / energy / articulation → rate, pitch, volume deltas
  * apply_glossary  — pronunciation respellings that change the *sound* only; the displayed transcript is untouched
  * resolve_voice   — a voice that cannot speak the text's language is replaced (and the change recorded), never silent
  * check_audio     — cheap integrity validation of what an engine returned
Anything unsupported or uncertain becomes a `note` for the application, never a guess.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import languages

# ─── Delivery controls ───────────────────────────────────────────────────────
# (rate %, pitch Hz, volume %) deltas on top of the emotion preset
PACE = {"slow": (-18, 0, 0), "relaxed": (-7, 0, 0), "conversational": (0, 0, 0), "brisk": (12, 1, 2)}
ENERGY = {"low": (-5, -2, -8), "moderate": (0, 0, 0), "high": (5, 3, 8)}
ARTICULATION = {"casual": (3, 0, 0), "balanced": (0, 0, 0), "precise": (-5, 0, 3)}
# the contract's emotion vocabulary → the engine's presets
EMOTION_ALIASES = {
    "reassuring": "gentle", "suspenseful": "hesitant", "amused": "playful", "surprised": "surprise", "confident": "serious",
    "whispered": "whisper", "hushed": "whisper", "scared": "fright", "afraid": "fright", "joyful": "excited", "tender": "gentle",
}


def style(pace: str | None = None, energy: str | None = None, articulation: str | None = None) -> tuple[int, int, int]:
    """Combined (rate, pitch, volume) delta. Unknown or missing settings contribute nothing (conservative default)."""
    total = [0, 0, 0]
    for table, key in ((PACE, pace), (ENERGY, energy), (ARTICULATION, articulation)):
        for i, v in enumerate(table.get((key or "").lower(), (0, 0, 0))):
            total[i] += v
    return total[0], total[1], total[2]


# ─── Text hygiene ────────────────────────────────────────────────────────────
_TAGS = re.compile(r"</?[A-Za-z][^<>]{0,120}>|<!--.*?-->", re.S)   # HTML/SSML-looking markup, not "a < b" prose
_FENCE = re.compile(r"```.*?```", re.S)


def sanitize(text: str) -> str:
    """Remove markup so it is never read aloud as words; wording and punctuation are left exactly as written."""
    text = _FENCE.sub(" ", text)
    text = _TAGS.sub(lambda m: "" if re.match(r"[,.;:!?]", text[m.end():m.end() + 1] or " ") else " ", text)
    text = re.sub(r"[*_`#]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


# ─── Language runs ───────────────────────────────────────────────────────────
@dataclass
class Run:
    text: str
    lang: str


_WORD = re.compile(r"\S+")


def _word_lang(word: str) -> str | None:
    """Script-based language of one word; None when it carries no letters (numbers, punctuation)."""
    counts = languages._script_counts(word)  # noqa: SLF001 — shared script table
    return max(counts, key=counts.get) if counts else None


def runs(text: str, base: str | None = None, min_foreign_words: int = 3) -> list[Run]:
    """Split into same-language runs. A Latin-script stretch inside Indic text (or the reverse) only becomes its own run when
    it is at least `min_foreign_words` long — shorter stretches are names, acronyms and product terms that must not flip the
    voice. Devanagari is resolved to Hindi/Marathi for the whole text, since the two share a script."""
    whole = base or languages.detect(text)
    words = _WORD.findall(text)
    if not words:
        return [Run(text, whole)]
    tagged: list[str] = []
    for w in words:
        lang = _word_lang(w)
        if lang in ("hi", "mr"):
            lang = whole if whole in ("hi", "mr") else lang
        tagged.append(lang or "")
    # neutral words (numbers/punctuation) join the language of their neighbours
    last = whole
    for i, lang in enumerate(tagged):
        if lang:
            last = lang
        else:
            tagged[i] = last
    # collapse into raw runs, then absorb the short foreign ones
    raw: list[list] = []
    for w, lang in zip(words, tagged):
        if raw and raw[-1][1] == lang:
            raw[-1][0].append(w)
        else:
            raw.append([[w], lang])
    for i, (ws, lang) in enumerate(raw):
        if len(ws) < min_foreign_words and len(raw) > 1:
            neighbour = raw[i - 1][1] if i > 0 else raw[i + 1][1]
            raw[i][1] = neighbour
    merged: list[Run] = []
    for ws, lang in raw:
        chunk = " ".join(ws)
        if merged and merged[-1].lang == lang:
            merged[-1].text += " " + chunk
        else:
            merged.append(Run(chunk, lang))
    return merged


# ─── Pronunciation glossary ──────────────────────────────────────────────────
def apply_glossary(text: str, glossary: dict[str, str] | None) -> str:
    """Replace listed terms by their respelling in the text that is *sent to the engine*. Whole words only, longest term first,
    case-sensitive (so “US” and “us” stay distinct)."""
    if not glossary:
        return text
    for term in sorted(glossary, key=len, reverse=True):
        if term and glossary[term]:
            text = re.sub(rf"(?<![\w]){re.escape(term)}(?![\w])", lambda _m, r=glossary[term]: r, text)
    return text


# ─── Voice ↔ language ────────────────────────────────────────────────────────
def voice_lang(voice: str) -> str | None:
    """Language code a voice id speaks, or None for multilingual voices (OpenAI, *Multilingual*) and unknown ids."""
    provider, _, name = voice.partition(":")
    if provider != "edge" or "Multilingual" in name:
        return None
    return name[:2].lower() if re.match(r"^[a-z]{2}-[A-Z]{2}-", name) else None


def resolve_voice(voice: str, lang: str, gender_hint: str | None = None) -> tuple[str, str | None]:
    """The voice to use for text in `lang`, and a note when it had to differ from the one requested.
    Falls back only to a voice of the *same* language; if none exists the requested voice is kept and the limitation reported."""
    spoken = voice_lang(voice)
    if spoken is None or spoken == lang:
        return voice, None
    target = languages.get(lang)
    if lang != target.code or not target.voices:
        return voice, f"No {target.name} voice is available; the text was read with {voice}, so pronunciation may be inaccurate."
    pick = target.voices[0][0]
    if gender_hint:
        pick = next((v[0] for v in target.voices if v[2].lower() == gender_hint.lower()), pick)
    return pick, f"{target.name} text was read with {pick} because {voice} speaks a different language."


# ─── Validation ──────────────────────────────────────────────────────────────
def check_audio(audio: bytes) -> str | None:
    """None when `audio` looks like a decodable MP3 (ID3 tag or frame sync); otherwise a description of the problem."""
    if not audio:
        return "The engine returned no audio."
    if audio[:3] == b"ID3" or (len(audio) > 1 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0):
        return None
    return "The audio is not a valid MP3 stream."


_AMBIGUOUS_DATE = re.compile(r"\b(0?[1-9]|1[0-2])[/-](0?[1-9]|1[0-2])[/-](\d{2}|\d{4})\b")


def review_flags(text: str) -> list[str]:
    """Readings that depend on locale and must not be guessed silently."""
    flags = []
    m = _AMBIGUOUS_DATE.search(text)
    if m and m.group(1) != m.group(2):
        flags.append(f"“{m.group(0)}” can be read day-first or month-first; the voice's own locale convention was used.")
    return flags


# ─── Human texture ───────────────────────────────────────────────────────────
POSITIONS = ("start", "mid", "end")
_QUOTED = re.compile(r"[\"“”‘’«»「」]")


def human_delta(text: str, position: str | None = None) -> tuple[int, int, int]:
    """Small, *deterministic* variations that stop a long read sounding like one sentence repeated.

    The same sentence always gets the same delivery (so cached clips and re-reads match); different sentences differ a little.
    A paragraph's first sentence opens slightly higher and slower, its last settles down and softer, quoted speech is livelier,
    and clauses joined by commas or dashes are paced a touch slower so thoughts have room."""
    h = int.from_bytes(__import__("hashlib").sha1(text.encode()).digest()[:3], "big")
    rate = (h % 7) - 3                    # −3 … +3 %
    pitch = ((h >> 4) % 5) - 2            # −2 … +2 Hz
    vol = ((h >> 8) % 5) - 2              # −2 … +2 %
    if position == "start":
        rate, pitch = rate - 2, pitch + 2
    elif position == "end":
        rate, pitch, vol = rate - 4, pitch - 2, vol - 3
    if _QUOTED.search(text):
        rate, pitch = rate + 2, pitch + 2
    if len(re.findall(r"[,;—–:]", text)) >= 3:
        rate -= 2
    return rate, pitch, vol


# ─── Symbols that make a voice stop or stumble ───────────────────────────────
_DECOR = re.compile(r"[*_~^|\\#•·▪▫◦●○■□★☆►▶◄◀→←↑↓§¶†‡]")


def speakable(text: str) -> str:
    """Turn decorative symbols and dashes into plain pauses *without changing the length*, so word timings still line up with the
    transcript. Bullets, arrows and rules become spaces; dashes, ellipses and a spaced hyphen become a comma-sized pause."""
    text = _DECOR.sub(" ", text)
    text = re.sub("[\u2014\u2013\u2015\u2012]", ",", text)
    text = text.replace("...", ",  ").replace("\u2026", ",").replace("--", ", ")
    return re.sub(r"(?<=\s)-(?=\s)", ",", text)
