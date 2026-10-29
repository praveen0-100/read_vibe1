"""Audio Overview — a spoken walk through a document, written *in* the listener's language.

Two formats:
  * conversation — two hosts talk the material through (curious host + explaining host), like a podcast;
  * narrative    — one storyteller carries the material along as an unfolding story.

The script is written natively (not machine-translated line by line) by the LLM, so Tamil sounds like Tamil. Without an
LLM the only thing that can be done honestly is to narrate a document that is *already* in the requested language
from its own sentences; anything needing translation says so instead of producing English.
"""
from __future__ import annotations

import hashlib
import json
import logging

from ..config import get_settings
from ..models import Document
from . import ai, directions, languages, llm, nlp, translate, tts

log = logging.getLogger("readvibe.overview")

FORMATS = ("conversation", "narrative")


class OverviewError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "turns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {"type": "string", "enum": ["host_a", "host_b", "narrator"]},
                    "text": {"type": "string"},
                    "emotion": {"type": "string", "enum": list(tts.EMOTIONS)},
                },
                "required": ["speaker", "text", "emotion"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "turns"],
    "additionalProperties": False,
}

_SYSTEM = (
    "You write the scripts for ReadVibe's Audio Overview: spoken, warm, intelligent audio that helps someone understand "
    "a document by listening. You write directly in the listener's own language, the way a gifted radio host or "
    "storyteller from that region would actually speak — natural spoken register, correct idiom and rhythm, never a "
    "stiff word-for-word translation. Ground every statement in the supplied text; never invent facts, names or numbers."
)


def _prompt(lang: languages.Language, fmt: str, title: str, doc_title: str, text: str, turns: tuple[int, int]) -> str:
    if fmt == "conversation":
        shape = (
            "FORMAT — a conversation between two hosts. host_a is curious and asks the questions a thoughtful listener "
            "would ask; host_b explains with clarity, one vivid example and one comparison to everyday life. Open with a "
            "warm greeting and a hook that makes the listener want to stay. Include one surprising point. Close with the "
            "single most useful takeaway and a friendly sign-off."
        )
    else:
        shape = (
            "FORMAT — a single narrator (speaker: narrator) telling the material as a story with an arc: set the scene "
            "and the question it raises, let the ideas unfold and build tension, reach the turning point, then resolve "
            "into the takeaway. Use concrete images and a steady, unhurried rhythm, like a well-loved audiobook narrator."
        )
    return (
        f"Write an audio overview of “{title}” (from “{doc_title}”) in {lang.name} ({lang.native}).\n\n"
        f"LANGUAGE — write ONLY in {lang.name}, in {lang.native} script, in natural spoken {lang.name}. Keep proper names "
        f"and the technical terms people genuinely say in English, but write them in {lang.native} script so a "
        f"{lang.name} voice pronounces them well. No romanised {lang.name}, no markdown, no emoji, no stage directions, no "
        "speaker labels inside the text. NEVER put bracketed notes, parentheticals about delivery or sound effects in the text — "
        "if a line should sound a certain way (warm, excited, curious, serious, gentle, whisper …) set its emotion field instead; "
        "the voice will act it, and nothing in the text is read out except words a person would say.\n"
        f"{shape}\n"
        f"LENGTH — {turns[0]}–{turns[1]} turns. Each turn is at most 3 short sentences (under 60 words) so it can be spoken "
        "in one natural breath.\n\n"
        f"<document>\n{text}\n</document>"
    )


def _extractive(text: str, title: str, lang: languages.Language) -> list[dict]:
    """No AI key, document already in the target language: narrate its own best sentences."""
    summary = nlp.summarize(text, title)
    lines = [title, summary["main_idea"], *summary["key_points"], summary["takeaways"]]
    seen, turns = set(), []
    for line in lines:
        line = " ".join((line or "").split())
        if line and line not in seen:
            seen.add(line)
            turns.append({"speaker": "narrator", "text": line})
    return turns


# The little things hosts say between points, written once in English and translated (and cached) per language.
_CONNECT = {
    "welcome": "Welcome to the audio overview. Today we are talking about:",
    "main": "So, what is the big idea?",
    "more": ["What else should we know?", "Tell me more.", "What stands out next?", "Is there anything else important?"],
    "example": "Can you give us an example?",
    "take": "So what is the one thing to remember?",
    "bye": "Thanks for listening. Happy reading!",
}
_CONTENT_BUDGET = 3600  # characters of source text we are willing to translate per overview (keeps the free allowance going far)


def _fit(sentence: str, limit: int = 380) -> str:
    sentence = " ".join((sentence or "").split())
    if len(sentence) <= limit:
        return sentence
    cut = max(sentence.rfind(". ", 0, limit), sentence.rfind("; ", 0, limit))
    return sentence[: cut + 1] if cut > 80 else sentence[:limit].rsplit(" ", 1)[0] + "…"


def _free(text: str, title: str, lang: languages.Language, doc_lang: str, fmt: str) -> tuple[list[dict], str, str]:
    """No AI key, document in another language: pick the text's key sentences, then translate them with the free service.

    Never invents anything — every point is a sentence of the document, translated. Returns (turns, title, note)."""
    summary = nlp.summarize(text, title)
    points, seen, spent = [], set(), 0
    for s in [summary["main_idea"], *summary["key_points"][:6], *summary["examples"][:2], summary["takeaways"]]:
        s = _fit(s)
        if s and s not in seen and spent + len(s) <= _CONTENT_BUDGET:
            seen.add(s)
            points.append(s)
            spent += len(s)
    if not points:
        raise OverviewError("There isn’t enough text here to build an overview from.")
    main, takeaway = points[0], (points[-1] if len(points) > 1 else None)
    middle = points[1:-1] if takeaway else []

    try:
        body = translate.translate_many([title, *points], lang.code, doc_lang)
        t_title, t_points = body[0], body[1:]
        words = [_CONNECT["welcome"], _CONNECT["main"], *_CONNECT["more"], _CONNECT["example"], _CONNECT["take"], _CONNECT["bye"]]
        c = dict(zip(["welcome", "main", "m0", "m1", "m2", "m3", "example", "take", "bye"], translate.translate_many(words, lang.code, "en")))
    except translate.TranslateError as exc:
        if exc.quota:
            raise OverviewError(
                f"Free translation has reached its daily limit for now, and it renews every day. Try again later — or set "
                f"READVIBE_TRANSLATE_EMAIL on the server to raise the free limit about tenfold, or add an AI key for unlimited overviews. ({exc})",
                503,
            ) from exc
        raise OverviewError(f"Free translation couldn’t be reached right now ({exc}). Please try again in a minute.", 503) from exc

    note = (f"Free mode: the key points of this text, translated automatically into {lang.name}. "
            "Add an AI key on the server for a longer, fully native script.")
    if fmt == "narrative":
        return [{"speaker": "narrator", "text": t} for t in [t_title, *t_points]], t_title, note

    a = lambda text, emotion="curious": {"speaker": "host_a", "text": text, "emotion": emotion}  # noqa: E731
    b = lambda text, emotion="neutral": {"speaker": "host_b", "text": text, "emotion": emotion}  # noqa: E731
    turns = [a(f"{c['welcome']} {t_title}", "warm"), a(c["main"]), b(t_points[0])]
    more = [c["m0"], c["m1"], c["m2"], c["m3"]]
    for i, point in enumerate(t_points[1 : 1 + len(middle)]):
        turns += [a(more[i % len(more)]), b(point)]
    if takeaway:
        turns += [a(c["take"]), b(t_points[-1])]
    turns.append(a(c["bye"], "warm"))
    return turns, t_title, note


# ─── Human texture for conversations ─────────────────────────────────────────
# Short listener reactions (“mm-hm”, “right”), the way people actually follow a long explanation. Only common, safe words
# per language; never a claim about the document. (text, emotion)
_REACTIONS: dict[str, list[tuple[str, str]]] = {
    "en": [("Mm-hm.", "warm"), ("Right.", "neutral"), ("Oh, interesting!", "surprise"), ("I see.", "curious"), ("That makes sense.", "warm")],
    "ta": [("ம்ம்.", "warm"), ("ஆமாம்.", "neutral"), ("அட, சுவாரஸ்யம்!", "surprise"), ("சரிதான்.", "warm")],
    "te": [("అవును.", "neutral"), ("ఓహో, ఆసక్తికరం!", "surprise"), ("నిజమే.", "warm"), ("అలాగా.", "curious")],
    "ml": [("അതെ.", "neutral"), ("ആഹാ, രസകരം!", "surprise"), ("ശരിയാണ്.", "warm"), ("ഓഹോ.", "curious")],
    "kn": [("ಹೌದು.", "neutral"), ("ಓಹೋ, ಆಸಕ್ತಿಕರ!", "surprise"), ("ಸರಿಯಾಗಿದೆ.", "warm"), ("ಅಚ್ಛಾ.", "curious")],
    "hi": [("हाँ, बिल्कुल।", "neutral"), ("अच्छा!", "surprise"), ("सही बात है।", "warm"), ("हम्म।", "curious")],
}
_LONG_TURN = 150


def humanise(turns: list[dict], code: str) -> list[dict]:
    """Insert a brief reaction from the *other* host after a long turn, no more often than every third turn and never at the end."""
    options = _REACTIONS.get(code)
    if not options:
        return turns
    out, since, n = [], 3, 0
    for i, t in enumerate(turns):
        out.append(t)
        since += 1
        last = i == len(turns) - 1
        if not last and since >= 3 and len(t["text"]) >= _LONG_TURN and t["speaker"] in ("host_a", "host_b") and turns[i + 1]["speaker"] != t["speaker"]:
            text, emotion = options[n % len(options)]
            other = "host_b" if t["speaker"] == "host_a" else "host_a"
            out.append({"speaker": other, "text": text, "voice": None, "emotion": emotion, "reaction": True})
            n, since = n + 1, 0
    return out


def _cache_path(doc: Document, chapter_index: int | None, code: str, fmt: str):
    stamp = doc.updated_at.isoformat() if doc.updated_at else ""
    key = hashlib.sha1(f"v2|{doc.id}|{stamp}|{chapter_index}|{code}|{fmt}|{llm.available()}".encode()).hexdigest()
    folder = get_settings().storage_dir / "overviews"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{key}.json"


def generate(doc: Document, chapter_index: int | None, language: str, fmt: str) -> dict:
    lang = languages.BY_CODE.get((language or "").lower())
    if lang is None:
        raise OverviewError(f"“{language}” isn’t a supported language")
    if not lang.voices:
        raise OverviewError(f"{lang.name} text is supported, but there is no natural {lang.name} voice yet — choose another language to listen in")
    if fmt not in FORMATS:
        raise OverviewError(f"Unknown format “{fmt}”")

    path = _cache_path(doc, chapter_index, lang.code, fmt)
    if path.exists():
        return json.loads(path.read_text("utf-8"))

    title, text, chapters = ai._scope(doc, chapter_index)
    doc_lang = languages.detect(text)
    engine = llm.provider_name()
    note = ""
    if llm.available():
        span = (14, 20) if chapter_index is not None else (22, 32)
        try:
            data = llm.complete_json(_SYSTEM, _prompt(lang, fmt, title, doc.title, ai._trim(text, 6000), span), _SCHEMA, max_tokens=9000)
        except llm.LLMUnavailable as exc:
            raise OverviewError(f"The AI service couldn’t write this overview right now ({exc}). Please try again.", 503) from exc
        raw_turns = data.get("turns", [])
        overview_title = (data.get("title") or title).strip()
    elif doc_lang == lang.code:
        engine = "local"
        raw_turns, overview_title = _extractive(text, title, lang), title
        fmt = "narrative"
    else:
        # no AI key and the text is in another language: free machine translation of the key points (no account needed)
        engine = "free translation"
        raw_turns, overview_title, note = _free(text, title, lang, doc_lang, fmt)

    voice_a, voice_b = lang.voices[0], lang.voices[1] if len(lang.voices) > 1 else lang.voices[0]
    hosts = {
        "host_a": {"name": voice_a[1], "voice": voice_a[0], "gender": voice_a[2]},
        "host_b": {"name": voice_b[1], "voice": voice_b[0], "gender": voice_b[2]},
        "narrator": {"name": voice_a[1], "voice": voice_a[0], "gender": voice_a[2]},
    }
    turns = []
    for t in raw_turns:
        text_ = directions.strip_for_speech(str(t.get("text", "")))  # a stray [direction] from the model is never read aloud
        speaker = t.get("speaker")
        if fmt == "narrative":
            speaker = "narrator"
        elif speaker not in ("host_a", "host_b"):
            speaker = "host_b"
        if text_:
            emotion = t.get("emotion") if t.get("emotion") in tts.PRESETS else "neutral"
            turns.append({"speaker": speaker, "text": text_, "voice": hosts[speaker]["voice"], "emotion": emotion})
    if not turns:
        raise OverviewError("The overview came back empty — please try again.", 503)
    if fmt == "conversation":
        turns = humanise(turns, lang.code)
        for t in turns:
            t["voice"] = hosts[t["speaker"]]["voice"]

    words = sum(len(t["text"].split()) for t in turns)
    result = {
        "document_id": doc.id,
        "chapter_index": chapter_index,
        "language": lang.code,
        "language_name": lang.name,
        "native": lang.native,
        "format": fmt,
        "title": overview_title,
        "engine": engine,
        "hosts": {k: v for k, v in hosts.items() if (k == "narrator") == (fmt == "narrative")},
        "turns": turns,
        "minutes": max(1, round(words / 125)),
        "note": note,
    }
    path.write_text(json.dumps(result, ensure_ascii=False), "utf-8")
    return result
