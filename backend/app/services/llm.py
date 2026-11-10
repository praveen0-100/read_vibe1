"""Free, key-less LLM access with automatic fail-over.

Every provider speaks the OpenAI-compatible ``/chat/completions`` protocol, so any of them can be swapped in:

  0. Groq, when READVIBE_GROQ_API_KEY is set: the primary model for everything (a fast small model handles short jobs);
  1. a provider you configure yourself (READVIBE_LLM_BASE_URL / _API_KEY / _MODEL — Groq, OpenRouter, Gemini's
     OpenAI endpoint, a local Ollama, …), tried first when set;
  2. Pollinations and LLM7, two free public endpoints that need no account or key.

A provider that fails is skipped for a short cool-down so a dead service never slows every request. Every caller must
still be prepared for `LLMUnavailable` and fall back to the local NLP engine, which needs no network at all.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass

import httpx

from ..config import get_settings

log = logging.getLogger("readvibe.llm")

COOLDOWN_SECONDS = 90
AUTH_COOLDOWN_SECONDS = 600  # a rejected key will not fix itself in a minute
GROQ_TPM_MARGIN = 500  # head-room under the per-minute token limit
GROQ_LONG_WAIT_SECONDS = 32  # the most a request will wait when both models are out of tokens for the minute
GROQ_MAX_WAIT_SECONDS = 12  # a rate limit that clears this fast is waited out instead of switching provider
RATE_LIMIT_COOLDOWN_SECONDS = 120  # 402/429 without a hint: the free tier said "enough for now"
_RETRY_AFTER = re.compile(r"retry after (\d+)\s*s", re.I)
_TRY_AGAIN = re.compile(r"try again in (?:(\d+)m)?\s*([\d.]+)s", re.I)  # Groq: "Please try again in 7.34s" / "1m3.2s"
MIN_TOKENS = 1200  # the free models are "thinking" models: their reasoning is spent from the same budget


class LLMUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Provider:
    name: str
    url: str
    model: str
    key: str | None = None
    fast_model: str | None = None  # a smaller, quicker model for short jobs (definitions, meanings)
    json_mode: bool = False  # the provider honours response_format={"type": "json_object"}


FREE_PROVIDERS = (
    Provider("llm7", "https://api.llm7.io/v1/chat/completions", "default", "unused"),
    # Pollinations allows one anonymous reply per 30 s per IP, so it is the second choice on a shared server address.
    Provider("pollinations", "https://text.pollinations.ai/openai", "openai"),
)

# Groq retires models now and then. When it says the configured one is gone, the first working chat model from /models is used instead
# (remembered until restart), so an outdated READVIBE_GROQ_MODEL never silently turns the AI off.
_GROQ_PREFERRED = ("openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.1-8b-instant")
_GROQ_NOT_CHAT = ("whisper", "orpheus", "guard", "safeguard", "tts", "embed")
_groq_pick: dict[str, str] = {}
_down_until: dict[str, float] = {}
_last_error: dict[str, str] = {}
_lock = threading.Lock()


def _providers() -> list[Provider]:
    s = get_settings()
    if not s.llm_enabled:
        return []
    out: list[Provider] = []
    if s.groq_api_key:
        out.append(Provider("groq", f"{s.groq_base_url.rstrip('/')}/chat/completions", _groq_pick.get(s.groq_model, s.groq_model), s.groq_api_key,
                            _groq_pick.get(s.groq_fast_model, s.groq_fast_model), True))
    if s.llm_base_url:
        base = s.llm_base_url.rstrip("/")
        url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        out.append(Provider("custom", url, s.llm_model or "gpt-4o-mini", s.llm_api_key))
    out.extend(FREE_PROVIDERS)
    return out


def available() -> bool:
    return bool(_providers())


def groq_enabled() -> bool:
    return any(p.name == "groq" for p in _providers())


def health() -> list[dict]:
    """Per-provider state for the status endpoint (no secrets)."""
    now = time.time()
    return [
        {"name": p.name, "model": p.model, "cooling_down_s": max(0, round(_down_until.get(p.name, 0) - now)), "last_error": _last_error.get(p.name)}
        for p in _providers()
    ]


_used = threading.local()  # which provider answered this thread's most recent call, so the "engine" badge tells the truth after a fall-back


def _label(p: Provider, fast: bool = False) -> str:
    if p.name == "groq":
        return f"Groq · {p.fast_model if fast and p.fast_model else p.model}"
    return f"{p.name} ({p.model})" if p.name == "custom" else "Free AI"


def provider_name() -> str:
    """The engine that answered the latest call on this thread (callers read it right after calling), else the configured primary."""
    used = getattr(_used, "label", None)
    return used or configured_name()


def configured_name() -> str:
    providers = _providers()
    if not providers:
        return "local"
    first = providers[0]
    return _label(first)


def _usable(providers: list[Provider]) -> list[Provider]:
    now = time.time()
    with _lock:
        live = [p for p in providers if _down_until.get(p.name, 0) <= now]
    return live or providers  # if everything is cooling down, still try (one may have recovered)


def _cooldown_for(exc: Exception) -> int:
    """How long to leave a provider alone: as long as it asks (Retry-After / "retry after 18s"), else a default."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return AUTH_COOLDOWN_SECONDS
        if code in (402, 429):
            header = exc.response.headers.get("retry-after", "")
            if header.replace(".", "", 1).isdigit():
                return min(int(float(header)) + 1, 600)
            text = exc.response.text or ""
            again = _TRY_AGAIN.search(text)
            if again:
                return min(int(int(again.group(1) or 0) * 60 + float(again.group(2))) + 1, 600)
            hint = _RETRY_AFTER.search(text)
            return min(int(hint.group(1)) + 1, 600) if hint else RATE_LIMIT_COOLDOWN_SECONDS
    return COOLDOWN_SECONDS


def _mark_down(p: Provider, seconds: int = COOLDOWN_SECONDS) -> None:
    with _lock:
        _down_until[p.name] = time.time() + seconds


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def _est_tokens(system: str, messages: list[dict]) -> int:
    """A deliberately pessimistic token estimate (Indian scripts and JSON schemas cost more tokens per character than English)."""
    return int((len(system) + sum(len(m.get("content") or "") for m in messages)) / 3.2)


def _post(p: Provider, system: str, messages: list[dict], max_tokens: int, json_mode: bool = False, fast: bool = False, temperature: float = 0.4) -> str:
    headers = {"Content-Type": "application/json"}
    if p.key:
        headers["Authorization"] = f"Bearer {p.key}"
    body = {
        "model": (p.fast_model if fast and p.fast_model else p.model),
        "messages": [{"role": "system", "content": system}, *messages],
        "max_tokens": max(max_tokens, MIN_TOKENS),
        "temperature": temperature,
    }
    if json_mode and p.json_mode:
        body["response_format"] = {"type": "json_object"}
    if p.name == "groq":
        # Groq meters tokens per minute as prompt + requested output, so ask for no more than what still fits in one minute's allowance.
        room = get_settings().groq_tpm_limit - GROQ_TPM_MARGIN - _est_tokens(system, messages)
        body["max_tokens"] = max(600, min(body["max_tokens"], room))
        if "gpt-oss" in body["model"]:
            body["reasoning_effort"] = "low" if (fast or json_mode) else "medium"  # reasoning models: keep thinking short, the budget is tight
    res = httpx.post(p.url, json=body, headers=headers, timeout=get_settings().llm_timeout_seconds)
    res.raise_for_status()
    data = res.json()
    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
    text = _THINK.sub("", content or "").strip()
    if not text:
        raise ValueError("empty response")
    return text


def _extract_json(text: str):
    """Parse the first JSON object in a model reply, tolerating code fences and chatter around it."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    raise ValueError("no JSON object in reply")


def _heal_groq(p: Provider, wanted: str) -> bool:
    """Groq no longer serves the wanted model: pick a model this key can use. True when a replacement was found."""
    try:
        res = httpx.get(p.url.rsplit("/chat/completions", 1)[0] + "/models", headers={"Authorization": f"Bearer {p.key}"}, timeout=15)
        res.raise_for_status()
        ids = [m["id"] for m in res.json().get("data", []) if not any(x in m["id"].lower() for x in _GROQ_NOT_CHAT)]
    except (httpx.HTTPError, ValueError, KeyError):
        return False
    pick = next((m for m in _GROQ_PREFERRED if m in ids), ids[0] if ids else None)
    if not pick or pick == wanted:
        return False
    _groq_pick[wanted] = pick
    log.warning("Groq model %s is not available to this key: using %s instead", wanted, pick)
    return True


def _wait_hint(exc: httpx.HTTPStatusError) -> float | None:
    """Seconds Groq says to wait ("Please try again in 4.2s" / Retry-After), or None."""
    header = exc.response.headers.get("retry-after", "")
    if header.replace(".", "", 1).isdigit():
        return float(header)
    again = _TRY_AGAIN.search(exc.response.text or "")
    return int(again.group(1) or 0) * 60 + float(again.group(2)) if again else None


def _attempt(p: Provider, system: str, messages: list[dict], max_tokens: int, json_mode: bool, fast: bool, temperature: float) -> tuple[str, bool, Provider]:
    """One provider, with Groq's two predictable hiccups handled: a retired model (pick another) and a full minute (wait or use the other model).
    Returns the text, whether the fast model produced it, and the provider as it was actually called."""
    args = (system, messages, max_tokens, json_mode)
    try:
        return _post(p, *args, fast, temperature), fast, p
    except httpx.HTTPStatusError as err:
        code = err.response.status_code
        if p.name != "groq":
            raise
        if code == 404 and "model" in err.response.text.lower() and _heal_groq(p, p.fast_model if fast and p.fast_model else p.model):
            healed = next(q for q in _providers() if q.name == "groq")  # same provider, now with a model that exists
            return _post(healed, *args, fast, temperature), fast, healed
        if code == 429:
            wait = _wait_hint(err)
            if wait is not None and wait <= GROQ_MAX_WAIT_SECONDS:
                log.info("Groq rate limit: waiting %.1fs", wait)
                time.sleep(wait + 0.4)
                return _post(p, *args, fast, temperature), fast, p
            if not fast and p.fast_model and p.fast_model != p.model:  # the small model has its own per-minute allowance
                log.info("Groq rate limit on %s: trying %s", p.model, p.fast_model)
                try:
                    return _post(p, *args, True, temperature), True, p
                except httpx.HTTPStatusError as again:
                    wait = _wait_hint(again) if again.response.status_code == 429 else None
                    fast = True
                    if wait is None:
                        raise
            # both allowances are spent: one longer wait for Groq still beats a slow detour through the free endpoints
            if wait is not None and wait <= GROQ_LONG_WAIT_SECONDS:
                log.info("Groq rate limit: waiting %.1fs", wait)
                time.sleep(wait + 0.4)
                return _post(p, *args, fast, temperature), fast, p
        raise


def _run(system: str, messages: list[dict], max_tokens: int, accept=None, json_mode: bool = False, fast: bool = False, temperature: float = 0.4) -> object:
    providers = _usable(_providers())
    if not providers:
        raise LLMUnavailable("No LLM configured")
    last = "no provider answered"
    for p in providers:
        try:
            text, used_fast, used = _attempt(p, system, messages, max_tokens, json_mode, fast, temperature)
            try:
                result = accept(text) if accept else text
            except ValueError:
                if p.name != "groq":
                    raise
                # a malformed reply is usually a one-off with these models: ask Groq once more before giving up on it
                text, used_fast, used = _attempt(p, system, messages, max_tokens, json_mode, fast, temperature)
                result = accept(text) if accept else text
            _used.label = _label(used, used_fast)
            return result
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            last = f"{p.name}: {type(exc).__name__} {exc}"[:200]
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else 0
            if status in (401, 403):
                last = f"{p.name}: the API key was rejected (HTTP {status}) — check it in backend/.env"
            _last_error[p.name] = last
            log.warning("LLM provider %s failed: %s", p.name, last)
            # a request that was too big or malformed says nothing about the provider: try the next one, keep this one in rotation
            if status not in (400, 413) and not isinstance(exc, ValueError):
                _mark_down(p, _cooldown_for(exc))
    raise LLMUnavailable(last)


def complete_text(system: str, messages: list[dict], max_tokens: int = 4000, fast: bool = False) -> str:
    return _run(system, messages, max_tokens, fast=fast)  # type: ignore[return-value]


def complete_json(system: str, prompt: str, schema: dict, max_tokens: int = 6000, fast: bool = False, temperature: float = 0.4) -> dict:
    required = schema.get("required", [])
    guide = (
        "Respond with ONE JSON object only — no prose, no code fences, no commentary — that follows this JSON Schema:\n"
        + json.dumps(schema, ensure_ascii=False)
    )

    def accept(text: str) -> dict:
        data = _extract_json(text)
        if not isinstance(data, dict) or any(k not in data for k in required):
            raise ValueError("reply did not match the schema")
        return data

    return _run(f"{system}\n\n{guide}", [{"role": "user", "content": prompt}], max_tokens, accept, json_mode=True, fast=fast, temperature=temperature)  # type: ignore[return-value]


READER_SYSTEM = (
    "You are ReadVibe's reading companion. You help people understand the document they are reading. "
    "Ground every answer in the provided document excerpts. If the excerpts do not contain the answer, say so "
    "plainly instead of guessing, and suggest what the reader could look for. Write clearly and warmly, and "
    "keep answers focused and readable on a small screen."
)

RESEARCH_SYSTEM = (
    "You are ReadVibe's research writing assistant. You draft academic text using only the supplied references "
    "and topic. Cite references with the bracketed numbers given (e.g. [2]). Never invent references, statistics, "
    "or findings that are not supported by the supplied abstracts; where support is thin, say what further "
    "evidence is needed."
)
