"""Narration script builder for the multi-tone text-to-audio engine.

The backend prepares a speech-ready script — chapter segmentation, sentence chunking, tone-specific
pacing, pitch and spoken transitions. The client renders it with the platform speech engine
(Web Speech API), which gives natural voices offline with no per-character cost. A server-side TTS
provider (ElevenLabs, OpenAI TTS, ...) can consume the same script unchanged.
"""
from __future__ import annotations

import re

from . import nlp

TONES = {
    "Regular": {
        "rate": 1.0, "pitch": 1.0, "sentence_pause": 250, "paragraph_pause": 650,
        "description": "Neutral, clear and balanced narration for everyday documents.",
    },
    "Humor": {
        "rate": 1.08, "pitch": 1.18, "sentence_pause": 180, "paragraph_pause": 500,
        "description": "Upbeat, expressive and engaging. Perfect for light fiction and comics.",
    },
    "Tough": {
        "rate": 0.92, "pitch": 0.82, "sentence_pause": 380, "paragraph_pause": 900,
        "description": "Authoritative and serious. Ideal for academic or historical content.",
    },
}

_INTROS = {
    "Regular": "{title}.",
    "Humor": "Alright, settle in — here comes {title}!",
    "Tough": "{title}.",
}
_OUTROS = {
    "Regular": "End of {title}.",
    "Humor": "And that's a wrap on {title}. Onwards!",
    "Tough": "This concludes {title}.",
}
_WORDS_PER_MINUTE = 165
MAX_SEGMENT_CHARS = 240


def _chunk_sentence(sentence: str) -> list[str]:
    """Speech engines truncate very long utterances; split at clause boundaries."""
    if len(sentence) <= MAX_SEGMENT_CHARS:
        return [sentence]
    parts = re.split(r"(?<=[,;:—])\s+", sentence)
    chunks, buf = [], ""
    for part in parts:
        if buf and len(buf) + len(part) + 1 > MAX_SEGMENT_CHARS:
            chunks.append(buf)
            buf = part
        else:
            buf = f"{buf} {part}".strip()
    if buf:
        chunks.append(buf)
    final = []
    for c in chunks:
        while len(c) > MAX_SEGMENT_CHARS:
            cut = c.rfind(" ", 0, MAX_SEGMENT_CHARS)
            cut = cut if cut > 40 else MAX_SEGMENT_CHARS
            final.append(c[:cut])
            c = c[cut:].strip()
        if c:
            final.append(c)
    return final


def _speakable(text: str) -> str:
    text = re.sub(r"\[\d+(?:[,–-]\d+)*\]", "", text)  # citation markers
    text = re.sub(r"https?://\S+", "link", text)
    text = text.replace("&", " and ").replace("%", " percent").replace("e.g.", "for example").replace("i.e.", "that is")
    return " ".join(text.split())


def build_script(chapters: list[tuple[int, str, str]], tone: str) -> tuple[list[dict], int]:
    cfg = TONES[tone]
    script = []
    total_seconds = 0
    for idx, title, content in chapters:
        segments = [{"text": _INTROS[tone].format(title=title), "pause_ms": cfg["paragraph_pause"], "kind": "intro"}]
        words = 0
        for para in nlp.paragraphs(content):
            sents = nlp.sentences(para) or [para]
            for s_i, sent in enumerate(sents):
                spoken = _speakable(sent)
                if not spoken:
                    continue
                words += len(spoken.split())
                pieces = _chunk_sentence(spoken)
                for p_i, piece in enumerate(pieces):
                    last_in_para = s_i == len(sents) - 1 and p_i == len(pieces) - 1
                    segments.append({
                        "text": piece,
                        "pause_ms": cfg["paragraph_pause"] if last_in_para else (cfg["sentence_pause"] if p_i == len(pieces) - 1 else 60),
                        "kind": "text",
                    })
        segments.append({"text": _OUTROS[tone].format(title=title), "pause_ms": cfg["paragraph_pause"], "kind": "outro"})
        seconds = round(words / (_WORDS_PER_MINUTE * cfg["rate"]) * 60 + len(segments) * cfg["sentence_pause"] / 1000)
        total_seconds += seconds
        script.append({"index": idx, "title": title, "segments": segments, "seconds": seconds})
    return script, total_seconds


def preview_text(tone: str) -> str:
    return {
        "Regular": "Welcome to ReadVibe. This is the regular voice — clear, balanced, and easy to follow for any document.",
        "Humor": "Hey there! This is the humor voice. Buckle up — even the footnotes are going to sound fun today.",
        "Tough": "This is the tough voice. Authoritative. Deliberate. Built for history, science and serious study.",
    }[tone]
