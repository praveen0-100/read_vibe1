"""LLM client: provider chain, JSON extraction and fail-over — all with the network stubbed out."""
import httpx
import pytest

from app.config import get_settings
from app.services import llm


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    llm._down_until.clear()
    yield
    llm._down_until.clear()


def _reply(text, status=200):
    def fake(url, json=None, headers=None, timeout=None):
        req = httpx.Request("POST", url)
        return httpx.Response(status, json={"choices": [{"message": {"content": text}}]}, request=req)
    return fake


def test_disabled_means_local_only():
    assert llm.available() is False
    assert llm.provider_name() == "local"
    with pytest.raises(llm.LLMUnavailable):
        llm.complete_text("s", [{"role": "user", "content": "hi"}])


def test_free_providers_are_used_without_any_key(enabled):
    assert llm.available() and llm.provider_name() == "Free AI"
    assert [p.name for p in llm._providers()] == ["llm7", "pollinations"]
    assert all(p.key in (None, "unused") for p in llm._providers())


def test_custom_provider_goes_first(enabled, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "llm_base_url", "https://example.test/v1/")
    monkeypatch.setattr(s, "llm_api_key", "k")
    monkeypatch.setattr(s, "llm_model", "m1")
    first = llm._providers()[0]
    assert first.url == "https://example.test/v1/chat/completions" and first.model == "m1" and first.key == "k"
    assert llm.provider_name() == "custom (m1)"


@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1}\n```', {"a": 1}),
    ('Sure! Here you go: {"a": {"b": "x}y"}} hope that helps', {"a": {"b": "x}y"}}),
    ('The user asks for JSON. {bad} then {"a": 2}', {"a": 2}),
])
def test_extract_json_is_tolerant(text, expected):
    assert llm._extract_json(text) == expected


def test_extract_json_rejects_prose():
    with pytest.raises(ValueError):
        llm._extract_json("no json here")


def test_complete_json_validates_required_keys(enabled, monkeypatch):
    monkeypatch.setattr(httpx, "post", _reply('{"summary": "ok"}'))
    out = llm.complete_json("sys", "prompt", {"type": "object", "required": ["summary"]})
    assert out == {"summary": "ok"}


def test_fails_over_to_the_next_provider_and_cools_the_first_down(enabled, monkeypatch):
    calls = []

    def fake(url, json=None, headers=None, timeout=None):
        calls.append(url)
        if "llm7" in url:
            raise httpx.ConnectError("down")
        return httpx.Response(200, json={"choices": [{"message": {"content": "<think>hmm</think>Hello there"}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake)
    assert llm.complete_text("s", [{"role": "user", "content": "hi"}]) == "Hello there"
    assert len(calls) == 2
    calls.clear()
    llm.complete_text("s", [{"role": "user", "content": "hi"}])
    assert calls == ["https://text.pollinations.ai/openai"]  # llm7 skipped during its cool-down


def test_wrong_schema_moves_on_then_raises(enabled, monkeypatch):
    monkeypatch.setattr(httpx, "post", _reply('{"other": 1}'))
    with pytest.raises(llm.LLMUnavailable):
        llm.complete_json("s", "p", {"type": "object", "required": ["summary"]})


def test_http_error_status_raises_unavailable(enabled, monkeypatch):
    monkeypatch.setattr(httpx, "post", _reply("x", status=500))
    with pytest.raises(llm.LLMUnavailable):
        llm.complete_text("s", [{"role": "user", "content": "hi"}])


def _status_error(status, text="", headers=None):
    req = httpx.Request("POST", "https://x.test")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(status, text=text, headers=headers or {}, request=req))


def test_cooldown_follows_the_retry_hint():
    assert llm._cooldown_for(_status_error(402, '{"message":"Free limit reached: 1 reply every 30 seconds per IP. Retry after 18s, or add a key"}')) == 19
    assert llm._cooldown_for(_status_error(429, "slow down", {"retry-after": "7"})) == 8
    assert llm._cooldown_for(_status_error(429, "slow down")) == llm.RATE_LIMIT_COOLDOWN_SECONDS
    assert llm._cooldown_for(_status_error(500)) == llm.COOLDOWN_SECONDS
    assert llm._cooldown_for(httpx.ConnectError("down")) == llm.COOLDOWN_SECONDS
    assert llm._cooldown_for(_status_error(429, "Retry after 99999s")) == 600
