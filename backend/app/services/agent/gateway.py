"""Multi-model gateway for the Vibe agent.

Vibe sticks to ONE model. `converse(system, messages, tools)` asks the primary model first, every time; it does not pick a
different model per request. It only moves on when the model it is using keeps failing:

  * a failed call is retried on the same model (MAX_ATTEMPTS tries in all) — a single hiccup never causes a switch;
  * a bad key / unknown model (401, 403, 404, 400) cannot recover by retrying, so that model is skipped immediately;
  * after the retries are used up the model is parked for a cool-down and the next one in the chain answers. That is the
    only moment a switch happens, and the reply carries a `switched_from` note so the reader can be told once.

The chain, best first: Anthropic (only if READVIBE_ANTHROPIC_API_KEY is set: primary, then a lighter backup) → your own
OpenAI-compatible endpoint (READVIBE_LLM_*) → the free public endpoints (text only). Messages use one internal format —
Anthropic-style content blocks — and are converted per provider, so a conversation can change model mid tool loop.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field

import httpx

from ...config import get_settings
from .. import llm

log = logging.getLogger("readvibe.agent.gateway")

MAX_ATTEMPTS = 3  # tries on one model before moving to the next
RETRY_DELAY_SECONDS = 0.6  # grows with each retry
PERMANENT_STATUSES = (400, 401, 403, 404)
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
AUTH_COOLDOWN_SECONDS = 600


class AgentUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Model:
    provider: str  # anthropic | custom | llm7 | pollinations
    wire: str  # anthropic | openai
    url: str
    model: str
    key: str | None
    tools: bool
    timeout: float

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class Turn:
    text: str
    tool_calls: list[ToolCall]
    model: Model
    blocks: list[dict] = field(default_factory=list)  # the assistant message, in internal block format
    switched_from: str | None = None  # set when this reply came from a backup because the previous model kept failing


_down_until: dict[str, float] = {}
_last_error: dict[str, str] = {}
_lock = threading.Lock()


def _anthropic_models() -> list[Model]:
    s = get_settings()
    if not s.anthropic_api_key:
        return []
    ids = [s.agent_model, *([s.agent_model_backup] if s.agent_model_backup and s.agent_model_backup != s.agent_model else [])]
    return [Model("anthropic", "anthropic", ANTHROPIC_URL, i, s.anthropic_api_key, True, 90.0) for i in ids]


def _custom_model() -> Model | None:
    s = get_settings()
    if not (s.llm_enabled and s.llm_base_url):
        return None
    base = s.llm_base_url.rstrip("/")
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    return Model("custom", "openai", url, s.llm_model or "gpt-4o-mini", s.llm_api_key, True, max(s.llm_timeout_seconds, 60.0))


def _free_models() -> list[Model]:
    s = get_settings()
    if not s.llm_enabled:
        return []
    return [Model(p.name, "openai", p.url, p.model, p.key, False, s.llm_timeout_seconds) for p in llm.FREE_PROVIDERS]


def chain() -> list[Model]:
    """The models Vibe may use, in order. The first one is the primary; the rest are backups."""
    if get_settings().agent_enabled is False:
        return []
    out = _anthropic_models()
    if custom := _custom_model():
        out.append(custom)
    out.extend(_free_models())
    return out


def available() -> bool:
    return bool(chain())


def has_tools() -> bool:
    return any(m.tools for m in chain())


def active() -> Model | None:
    """The model that would answer right now: the first in the chain that is not parked."""
    now = time.time()
    return next((m for m in chain() if _down_until.get(m.label, 0) <= now), None)


def status() -> dict:
    now = time.time()
    current = active()
    return {
        "available": available(),
        "tools": has_tools(),
        "models": [{"provider": m.provider, "model": m.model, "tools": m.tools, "primary": i == 0,
                    "active": bool(current and m.label == current.label),
                    "cooling_down_s": max(0, round(_down_until.get(m.label, 0) - now)), "last_error": _last_error.get(m.label)}
                   for i, m in enumerate(chain())],
    }


def _flatten(messages: list[dict]) -> list[dict]:
    """For text-only models: turn tool_use / tool_result blocks into plain text so the history still makes sense."""
    out: list[dict] = []
    for m in messages:
        c = m["content"]
        if isinstance(c, str):
            out.append({"role": m["role"], "content": c})
            continue
        parts = []
        for b in c:
            if b["type"] == "text":
                parts.append(b["text"])
            elif b["type"] == "tool_use":
                parts.append(f"[looked up: {b['name']}({json.dumps(b['input'], ensure_ascii=False)})]")
            elif b["type"] == "tool_result":
                parts.append(f"[result]\n{b['content']}")
        if parts:
            role = m["role"]
            if out and out[-1]["role"] == role:
                out[-1]["content"] += "\n\n" + "\n".join(parts)
            else:
                out.append({"role": role, "content": "\n".join(parts)})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def _to_openai(system: str, messages: list[dict]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": system}]
    for m in messages:
        c = m["content"]
        if isinstance(c, str):
            out.append({"role": m["role"], "content": c})
        elif m["role"] == "assistant":
            text = "".join(b["text"] for b in c if b["type"] == "text")
            calls = [{"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["input"], ensure_ascii=False)}}
                     for b in c if b["type"] == "tool_use"]
            msg: dict = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:
            for b in c:
                if b["type"] == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": b["content"]})
                elif b["type"] == "text":
                    out.append({"role": "user", "content": b["text"]})
    return out


def _call_anthropic(m: Model, system: str, messages: list[dict], tools: list[dict] | None, max_tokens: int) -> Turn:
    body: dict = {"model": m.model, "max_tokens": max_tokens, "system": system, "messages": messages}
    if tools:
        body["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]} for t in tools]
    res = httpx.post(ANTHROPIC_URL, json=body, timeout=m.timeout,
                     headers={"x-api-key": m.key or "", "anthropic-version": "2023-06-01", "content-type": "application/json"})
    res.raise_for_status()
    blocks = [b for b in res.json().get("content", []) if b.get("type") in ("text", "tool_use")]
    text = "".join(b["text"] for b in blocks if b["type"] == "text").strip()
    calls = [ToolCall(b["id"], b["name"], b.get("input") or {}) for b in blocks if b["type"] == "tool_use"]
    if not text and not calls:
        raise ValueError("empty response")
    return Turn(text, calls, m, [{"type": "text", "text": b["text"]} if b["type"] == "text" else b for b in blocks])


def _call_openai(m: Model, system: str, messages: list[dict], tools: list[dict] | None, max_tokens: int) -> Turn:
    headers = {"Content-Type": "application/json"}
    if m.key:
        headers["Authorization"] = f"Bearer {m.key}"
    use_tools = bool(tools) and m.tools
    body: dict = {
        "model": m.model,
        "messages": _to_openai(system, messages if use_tools else _flatten(messages)),
        "max_tokens": max(max_tokens, llm.MIN_TOKENS),
        "temperature": 0.5,
    }
    if use_tools:
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools or []]
    res = httpx.post(m.url, json=body, headers=headers, timeout=m.timeout)
    res.raise_for_status()
    msg = ((res.json().get("choices") or [{}])[0].get("message")) or {}
    text = llm._THINK.sub("", msg.get("content") or "").strip()
    calls: list[ToolCall] = []
    for c in msg.get("tool_calls") or []:
        fn = c.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append(ToolCall(c.get("id") or uuid.uuid4().hex[:12], fn.get("name", ""), args if isinstance(args, dict) else {}))
    if not text and not calls:
        raise ValueError("empty response")
    blocks: list[dict] = ([{"type": "text", "text": text}] if text else []) + [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.args} for c in calls]
    return Turn(text, calls, m, blocks)


def _cooldown(m: Model, exc: Exception) -> int:
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (401, 403, 404):
        return AUTH_COOLDOWN_SECONDS  # bad key or unknown model: retrying in a minute will not help
    return llm._cooldown_for(exc)


def _permanent(exc: Exception) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in PERMANENT_STATUSES


def converse(system: str, messages: list[dict], tools: list[dict] | None = None, max_tokens: int = 2500) -> Turn:
    """One assistant turn from the first model that works. Raises AgentUnavailable when none does."""
    pool = chain()
    if not pool:
        raise AgentUnavailable("No AI model is configured")
    now = time.time()
    with _lock:
        live = [m for m in pool if _down_until.get(m.label, 0) <= now]
    last, abandoned = "no model answered", None
    for m in live or pool:
        call = _call_anthropic if m.wire == "anthropic" else _call_openai
        fatal = False
        for attempt in range(MAX_ATTEMPTS):
            try:
                turn = call(m, system, messages if m.tools else _flatten(messages), tools if m.tools else None, max_tokens)
                turn.switched_from = abandoned
                return turn
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                last = f"{m.label}: {type(exc).__name__} {exc}"[:200]
                _last_error[m.label] = last
                log.warning("agent model %s failed (try %d/%d): %s", m.label, attempt + 1, MAX_ATTEMPTS, last)
                if _permanent(exc):
                    fatal = True
                    break
                if attempt + 1 < MAX_ATTEMPTS:
                    time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
        # the model kept failing: park it and let the next one in the chain answer
        with _lock:
            _down_until[m.label] = time.time() + (AUTH_COOLDOWN_SECONDS if fatal else llm.COOLDOWN_SECONDS)
        abandoned = abandoned or m.model
    raise AgentUnavailable(last)

