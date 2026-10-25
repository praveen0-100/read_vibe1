"""Free, key-less LLM access with automatic fail-over.

Every provider speaks the OpenAI-compatible ``/chat/completions`` protocol, so any of them can be swapped in:

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
RATE_LIMIT_COOLDOWN_SECONDS = 300  # 402/429: the free tier said "enough for now"
MIN_TOKENS = 1200  # the free models are "thinking" models: their reasoning is spent from the same budget


class LLMUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Provider:
    name: str
    url: str
    model: str
    key: str | None = None


FREE_PROVIDERS = (
    Provider("pollinations", "https://text.pollinations.ai/openai", "openai"),
    Provider("llm7", "https://api.llm7.io/v1/chat/completions", "default", "unused"),
)

_down_until: dict[str, float] = {}
_last_error: dict[str, str] = {}
_lock = threading.Lock()


def _providers() -> list[Provider]:
    s = get_settings()
    if not s.llm_enabled:
        return []
    out: list[Provider] = []
    if s.llm_base_url:
        base = s.llm_base_url.rstrip("/")
        url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
        out.append(Provider("custom", url, s.llm_model or "gpt-4o-mini", s.llm_api_key))
    out.extend(FREE_PROVIDERS)
    return out


def available() -> bool:
    return bool(_providers())


def health() -> list[dict]:
    """Per-provider state for the status endpoint (no secrets)."""
    now = time.time()
    return [
        {"name": p.name, "model": p.model, "cooling_down_s": max(0, round(_down_until.get(p.name, 0) - now)), "last_error": _last_error.get(p.name)}
        for p in _providers()
    ]


def provider_name() -> str:
    providers = _providers()
    if not providers:
        return "local"
    first = providers[0]
    return f"{first.name} ({first.model})" if first.name == "custom" else "Free AI"


def _usable(providers: list[Provider]) -> list[Provider]:
    now = time.time()
    with _lock:
        live = [p for p in providers if _down_until.get(p.name, 0) <= now]
    return live or providers  # if everything is cooling down, still try (one may have recovered)


def _mark_down(p: Provider, seconds: int = COOLDOWN_SECONDS) -> None:
    with _lock:
        _down_until[p.name] = time.time() + seconds


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def _post(p: Provider, system: str, messages: list[dict], max_tokens: int) -> str:
    headers = {"Content-Type": "application/json"}
    if p.key:
        headers["Authorization"] = f"Bearer {p.key}"
    body = {
        "model": p.model,
        "messages": [{"role": "system", "content": system}, *messages],
        "max_tokens": max(max_tokens, MIN_TOKENS),
        "temperature": 0.4,
    }
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


def _run(system: str, messages: list[dict], max_tokens: int, accept=None) -> object:
    providers = _usable(_providers())
    if not providers:
        raise LLMUnavailable("No LLM configured")
    last = "no provider answered"
    for p in providers:
        try:
            text = _post(p, system, messages, max_tokens)
            return accept(text) if accept else text
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            last = f"{p.name}: {type(exc).__name__} {exc}"[:200]
            _last_error[p.name] = last
            log.warning("LLM provider %s failed: %s", p.name, last)
            limited = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (402, 429)
            _mark_down(p, RATE_LIMIT_COOLDOWN_SECONDS if limited else COOLDOWN_SECONDS)
    raise LLMUnavailable(last)


def complete_text(system: str, messages: list[dict], max_tokens: int = 4000) -> str:
    return _run(system, messages, max_tokens)  # type: ignore[return-value]


def complete_json(system: str, prompt: str, schema: dict, max_tokens: int = 6000) -> dict:
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

    return _run(f"{system}\n\n{guide}", [{"role": "user", "content": prompt}], max_tokens, accept)  # type: ignore[return-value]


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
