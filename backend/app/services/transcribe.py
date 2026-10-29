"""Speech-to-text with NVIDIA Nemotron-3.5-Transcribe-30B-A4B.

The model is a 34B-parameter speech language model that needs a GPU, so this module is a *client*: it sends the recording to an
OpenAI-compatible chat endpoint that serves the model (vLLM, exactly as in the model card) and turns the reply into a clean
transcript. What the card specifies and this follows:

  * the audio travels as an `audio_url` data URI in the user message, with the instruction as text;
  * temperature 0, reasoning off (`enable_thinking: False`), `skip_special_tokens: False` so speaker tags survive;
  * no `max_tokens` — a dense hour of speech can need ~20k tokens and the server's default is the remaining context;
  * speaker turns come back inline as `<spk:0> … <spk:1> …`; word timestamps (optional) come back as `ctc_timestamps.words`.

The request body is streamed (the base64 is produced chunk by chunk), so a large recording never sits in memory twice.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from collections.abc import Iterator
from pathlib import Path

import httpx

from ..config import get_settings

log = logging.getLogger("readvibe.transcribe")


class TranscribeError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


# Instructions are the ones the model card recommends for each style.
STYLES: dict[str, str] = {
    "readable": ("Audio transcription. Language: as spoken. Wording: omit fillers and accidental repetitions; keep the remaining spoken wording "
                 "unchanged. Formatting: punctuation and capitalization. Output: transcript only."),
    "verbatim": ("Audio transcription. Language: as spoken. Wording: verbatim, including fillers and repetitions. Formatting: punctuation and "
                 "capitalization. Output: transcript only."),
    "speakers": ("Transcribe this audio with punctuation and capitalization. Include all spoken words and verbal fillers. Write numbers in their "
                 "standard written form. Put speaker tags <spk:0> <spk:1> <spk:2> <spk:3> on the transcription."),
}

MIME = {"wav": "audio/wav", "mp3": "audio/mpeg", "flac": "audio/flac", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
        "m4a": "audio/mp4", "mp4": "audio/mp4", "aac": "audio/aac", "webm": "audio/webm"}
SUPPORTED = tuple(MIME)

_TAG = re.compile(r"<(?:ev|sty):[^>]*>|<\|[^|>]*\|>")
_SPK = re.compile(r"<spk:(\d+)>")
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def configured() -> bool:
    return bool(get_settings().transcribe_base_url)


def status() -> dict:
    s = get_settings()
    return {"configured": configured(), "model": s.transcribe_model, "max_mb": s.transcribe_max_mb, "styles": list(STYLES), "formats": list(SUPPORTED)}


def _one_line(value: str | None, limit: int) -> str:
    return " ".join((value or "").split())[:limit]


def build_prompt(style: str = "readable", translate_to: str | None = None, context: str | None = None) -> str:
    if translate_to := _one_line(translate_to, 40):
        return f"Please translate the given speech to {translate_to}."
    if context := _one_line(context, 400):
        return f"Transcribe with punctuation and capitalization. Context terms: {context}."
    return STYLES.get(style, STYLES["readable"])


def _endpoint() -> str:
    base = (get_settings().transcribe_base_url or "").rstrip("/")
    return base if base.endswith("/chat/completions") else f"{base}/chat/completions"


def _body_parts(prompt: str, mime: str, path: Path, timestamps: bool) -> tuple[Iterator[bytes], int]:
    """The JSON request body as a byte stream plus its exact length, with the audio base64-encoded on the fly."""
    s = get_settings()
    extra: dict = {"chat_template_kwargs": {"enable_thinking": False}, "skip_special_tokens": False,
             "spaces_between_special_tokens": False, "seed": 0}
    if timestamps:
        extra["mm_processor_kwargs"] = {"capture_ctc_timestamps": True}
    marker = "@@AUDIO@@"
    template = json.dumps({
        "model": s.transcribe_model,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "audio_url", "audio_url": {"url": f"data:{mime};base64,{marker}"}}]}],
        "temperature": 0, **extra,
    }, ensure_ascii=False)
    head, tail = (part.encode() for part in template.split(marker))
    size = path.stat().st_size
    length = len(head) + 4 * ((size + 2) // 3) + len(tail)

    def chunks() -> Iterator[bytes]:
        yield head
        with path.open("rb") as fh:
            while block := fh.read(3 * 1024 * 1024):  # a multiple of 3, so each block encodes without padding
                yield base64.b64encode(block)
        yield tail

    return chunks(), length


def _post(body: Iterator[bytes], length: int) -> dict:
    s = get_settings()
    headers = {"Content-Type": "application/json", "Content-Length": str(length)}
    if s.transcribe_api_key:
        headers["Authorization"] = f"Bearer {s.transcribe_api_key}"
    try:
        res = httpx.post(_endpoint(), content=body, headers=headers, timeout=httpx.Timeout(s.transcribe_timeout_seconds, connect=15.0))
    except httpx.TimeoutException as exc:
        raise TranscribeError("The transcription server took too long to answer.", 504) from exc
    except httpx.HTTPError as exc:
        raise TranscribeError("The transcription server could not be reached.", 502) from exc
    if res.status_code >= 400:
        log.warning("transcription server answered %s: %s", res.status_code, res.text[:300])
        detail = {401: "The transcription server rejected the API key.", 413: "The transcription server says this recording is too large.",
                  429: "The transcription server is busy. Try again in a minute."}.get(res.status_code, f"The transcription server returned an error ({res.status_code}).")
        raise TranscribeError(detail, 502)
    try:
        return res.json()
    except ValueError as exc:
        raise TranscribeError("The transcription server sent an unreadable reply.") from exc


def turns_from(raw: str) -> list[dict]:
    """Split model output on its `<spk:N>` tags into [{speaker, text}]. Without tags the whole text is one turn."""
    parts = _SPK.split(raw)
    if len(parts) == 1:
        text = parts[0].strip()
        return [{"speaker": None, "text": text}] if text else []
    turns = []
    lead = parts[0].strip()
    if lead:
        turns.append({"speaker": None, "text": lead})
    for i in range(1, len(parts), 2):
        text = parts[i + 1].strip()
        if text:
            turns.append({"speaker": int(parts[i]), "text": text})
    return turns


def clean(raw: str) -> str:
    return " ".join(_TAG.sub(" ", _THINK.sub("", raw)).split())


def render(turns: list[dict]) -> str:
    """Readable text: plain paragraphs, or 'Speaker N:' paragraphs when the model tagged speakers."""
    if any(t["speaker"] is not None for t in turns):
        return "\n\n".join(f"Speaker {t['speaker'] + 1}: {t['text']}" if t["speaker"] is not None else t["text"] for t in turns)
    return "\n\n".join(t["text"] for t in turns)


def transcribe(path: Path, filename: str, *, style: str = "readable", translate_to: str | None = None, context: str | None = None,
               timestamps: bool = False) -> dict:
    """Transcribe the audio file at `path`. Returns {text, turns, words, model, style}."""
    if not configured():
        raise TranscribeError("Transcription isn’t set up on this server yet.", 503)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in MIME:
        raise TranscribeError(f"Unsupported audio type. Supported: {', '.join(SUPPORTED)}", 415)
    style = style if style in STYLES else "readable"
    if timestamps:
        style = "speakers"  # the model card ties word timestamps to the speaker-tagged prompt
    body, length = _body_parts(build_prompt(style, translate_to, context), MIME[ext], path, timestamps)
    data = _post(body, length)
    message = ((data.get("choices") or [{}])[0].get("message")) or {}
    raw = _THINK.sub("", message.get("content") or "")
    turns = [{"speaker": t["speaker"], "text": clean(t["text"])} for t in turns_from(raw)]
    turns = [t for t in turns if t["text"]]
    if not turns:
        raise TranscribeError("No speech was found in that recording.", 422)
    words = [{"word": w.get("word"), "start": w.get("start"), "end": w.get("end"), "speaker": w.get("speaker")}
             for w in ((data.get("ctc_timestamps") or {}).get("words") or []) if isinstance(w, dict)]
    return {"text": render(turns), "turns": turns, "words": words, "model": get_settings().transcribe_model, "style": style}
