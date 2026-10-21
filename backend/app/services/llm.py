"""Optional Claude provider.

Enabled when READVIBE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) is set. Every caller must be
prepared for `LLMUnavailable` and fall back to the local NLP engine.
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache

from ..config import get_settings

log = logging.getLogger("readvibe.llm")

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMUnavailable(Exception):
    pass


@lru_cache
def _client():
    settings = get_settings()
    key = settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        log.warning("anthropic package not installed; using local engine")
        return None
    return anthropic.Anthropic(api_key=key, timeout=90.0, max_retries=2)


def available() -> bool:
    return _client() is not None


def provider_name() -> str:
    return f"claude ({get_settings().anthropic_model})" if available() else "local"


def _call(system: str, messages: list[dict], max_tokens: int, output_format: dict | None = None) -> str:
    client = _client()
    if client is None:
        raise LLMUnavailable("No LLM configured")
    import anthropic

    settings = get_settings()
    output_config: dict = {"effort": settings.ai_effort}
    if output_format:
        output_config["format"] = output_format
    try:
        response = client.beta.messages.create(
            model=settings.anthropic_model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            output_config=output_config,
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
    except anthropic.RateLimitError as exc:
        raise LLMUnavailable("Claude rate limit reached") from exc
    except anthropic.APIStatusError as exc:
        log.warning("Claude API error %s: %s", exc.status_code, exc.message)
        raise LLMUnavailable(f"Claude API error {exc.status_code}") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMUnavailable("Could not reach Claude") from exc

    if response.stop_reason == "refusal":
        raise LLMUnavailable("Claude declined this request")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        raise LLMUnavailable("Empty response from Claude")
    return text


def complete_text(system: str, messages: list[dict], max_tokens: int = 4000) -> str:
    return _call(system, messages, max_tokens)


def complete_json(system: str, prompt: str, schema: dict, max_tokens: int = 6000) -> dict:
    text = _call(
        system,
        [{"role": "user", "content": prompt}],
        max_tokens,
        output_format={"type": "json_schema", "schema": schema},
    )
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMUnavailable("Claude returned malformed JSON") from exc


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
