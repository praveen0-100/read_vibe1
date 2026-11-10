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


# ─── Groq as the primary model ────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _fresh_thread_state():
    llm._used.__dict__.clear()
    yield
    llm._used.__dict__.clear()


@pytest.fixture
def groq(enabled, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "groq_api_key", "gsk_test")
    return s


def test_groq_goes_first_with_its_models(groq):
    first = llm._providers()[0]
    assert first.name == "groq" and first.key == "gsk_test"
    assert first.url == "https://api.groq.com/openai/v1/chat/completions"
    assert first.model == "openai/gpt-oss-120b" and first.fast_model == "openai/gpt-oss-20b"
    assert llm.groq_enabled() and llm.configured_name() == "Groq · openai/gpt-oss-120b"
    assert [p.name for p in llm._providers()][-2:] == ["llm7", "pollinations"]  # the free endpoints stay as fall-backs


def test_no_groq_key_means_no_groq(enabled):
    assert not llm.groq_enabled()


def test_groq_request_shape_json_mode_and_fast_model(groq, monkeypatch):
    seen = {}

    def fake(url, json=None, headers=None, timeout=None):
        seen.update(url=url, body=json, headers=headers)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"meaning": "a thing"}'}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake)
    out = llm.complete_json("sys", "define x", {"type": "object", "required": ["meaning"]}, fast=True)
    assert out == {"meaning": "a thing"}
    assert seen["headers"]["Authorization"] == "Bearer gsk_test"
    assert seen["body"]["model"] == "openai/gpt-oss-20b"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert llm.provider_name() == "Groq · openai/gpt-oss-20b"
    llm.complete_text("sys", [{"role": "user", "content": "hi"}])  # plain text: the big model, no JSON mode
    assert seen["body"]["model"] == "openai/gpt-oss-120b" and "response_format" not in seen["body"]


def test_rate_limited_groq_cools_down_for_as_long_as_it_asks_and_a_free_provider_answers(groq, monkeypatch):
    calls = []

    def fake(url, json=None, headers=None, timeout=None):
        calls.append(url)
        req = httpx.Request("POST", url)
        if "groq" in url:
            return httpx.Response(429, json={"error": {"message": "Rate limit reached. Please try again in 7.3s."}}, request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "fallback answer"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", fake)
    assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "fallback answer"
    assert llm.provider_name() == "Free AI"  # the badge names who really answered
    assert 7 <= llm._down_until["groq"] - __import__("time").time() <= 10
    n = len(calls)
    llm.complete_text("s", [{"role": "user", "content": "q"}])
    assert not any("groq" in u for u in calls[n:])  # parked: not retried while cooling down


def test_an_oversized_request_does_not_park_groq(groq, monkeypatch):
    def fake(url, json=None, headers=None, timeout=None):
        req = httpx.Request("POST", url)
        if "groq" in url:
            return httpx.Response(413, json={"error": {"message": "Request too large"}}, request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", fake)
    assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "ok"
    assert "groq" not in llm._down_until or llm._down_until["groq"] <= __import__("time").time()


def test_a_rejected_key_is_reported_plainly_and_parked_long(groq, monkeypatch):
    def fake(url, json=None, headers=None, timeout=None):
        req = httpx.Request("POST", url)
        if "groq" in url:
            return httpx.Response(401, json={"error": {"message": "Invalid API Key"}}, request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", fake)
    llm.complete_text("s", [{"role": "user", "content": "q"}])
    assert "key was rejected" in llm._last_error["groq"]
    assert llm._down_until["groq"] - __import__("time").time() > 500


def test_ai_meaning_uses_the_fast_model_and_is_cached(groq, monkeypatch):
    from app.services import lookup

    lookup._ai_cache.clear()
    bodies = []

    def fake(url, json=None, headers=None, timeout=None):
        bodies.append(json)
        content = '{"meaning": "Fleeting; lasting a very short time.", "part_of_speech": "adjective", "simple": "short-lived", "example": "A ephemeral joy.", "in_context": ""}'
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake)
    first = lookup.ai_meaning("ephemeral", "en")
    assert first["meaning"].startswith("Fleeting") and first["engine"] == "Groq · openai/gpt-oss-20b" and first["cached"] is False
    assert bodies[0]["model"] == "openai/gpt-oss-20b"
    assert lookup.ai_meaning("ephemeral", "en")["cached"] is True and len(bodies) == 1


def test_ai_meaning_is_none_without_a_model():
    from app.services import lookup

    assert lookup.ai_meaning("anything", "en") is None


def test_a_retired_groq_model_is_replaced_by_one_the_key_can_use(groq, monkeypatch):
    llm._groq_pick.clear()
    monkeypatch.setattr(groq, "groq_model", "llama-3.3-70b-versatile")
    posted = []

    def post(url, json=None, headers=None, timeout=None):
        posted.append(json["model"])
        req = httpx.Request("POST", url)
        if json["model"] == "llama-3.3-70b-versatile":
            return httpx.Response(404, json={"error": {"message": "The model `llama-3.3-70b-versatile` does not exist", "code": "model_not_found"}}, request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]}, request=req)

    def get(url, headers=None, timeout=None):
        return httpx.Response(200, json={"data": [{"id": "whisper-large-v3"}, {"id": "openai/gpt-oss-20b"}, {"id": "openai/gpt-oss-120b"}]}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    try:
        assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "hello"
        assert posted == ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]
        assert llm.provider_name() == "Groq · openai/gpt-oss-120b"
        assert llm._providers()[0].model == "openai/gpt-oss-120b"  # remembered: no second 404
    finally:
        llm._groq_pick.clear()


def test_gpt_oss_gets_a_reasoning_effort_that_matches_the_job(groq, monkeypatch):
    seen = []

    def post(url, json=None, headers=None, timeout=None):
        seen.append(json.get("reasoning_effort"))
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    llm.complete_text("s", [{"role": "user", "content": "q"}], fast=True)
    llm.complete_text("s", [{"role": "user", "content": "q"}])
    assert seen == ["low", "medium"]


def _fake_doc():
    from types import SimpleNamespace

    ch = [SimpleNamespace(position=0, title="One", content="Alpha beta gamma. " * 40), SimpleNamespace(position=1, title="Two", content="Delta epsilon. " * 40)]
    return SimpleNamespace(id="doc-mm", title="A Book", updated_at=None, chapters=ch)


def test_mind_map_uses_the_ai_and_keeps_the_local_tree_shape(groq, monkeypatch):
    from app.services import ai

    ai._cache.clear() if hasattr(ai._cache, "clear") else None
    reply = ('{"branches": [{"label": "Origins", "detail": "Where it began.", "children": [{"label": "First steps", "detail": "x"}]},'
             ' {"label": "Growth", "detail": "How it grew.", "children": []}]}')
    monkeypatch.setattr(httpx, "post", lambda url, json=None, headers=None, timeout=None: httpx.Response(
        200, json={"choices": [{"message": {"content": reply}}]}, request=httpx.Request("POST", url)))
    out = ai.mind_map(_fake_doc(), 0)
    assert out["engine"].startswith("Groq")
    assert [b["label"] for b in out["root"]["children"]] == ["Origins", "Growth"]
    assert out["root"]["children"][0]["children"][0]["id"] == "k0-0" and out["root"]["children"][0]["chapter_index"] == 0


def test_mind_map_falls_back_to_the_local_engine_when_the_ai_is_down(enabled, monkeypatch):
    from app.services import ai

    monkeypatch.setattr(httpx, "post", lambda url, json=None, headers=None, timeout=None: httpx.Response(500, json={}, request=httpx.Request("POST", url)))
    out = ai.mind_map(_fake_doc(), 1)
    assert out["engine"] == "local" and out["root"]["children"]


# ─── Groq free-tier limits: tokens per minute ─────────────────────────────────────────────────────────────────────────────
def _tpm_429(wait="3.0"):
    return {"error": {"message": f"Rate limit reached ... on tokens per minute (TPM): Limit 8000, Used 4000, Requested 5000. Please try again in {wait}s."}}


def test_groq_output_is_sized_to_fit_the_minute(groq, monkeypatch):
    seen = {}

    def post(url, json=None, headers=None, timeout=None):
        seen.update(json)
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    llm.complete_text("s", [{"role": "user", "content": "word " * 5000}], max_tokens=7500)  # ~7.8k estimated prompt tokens: nothing left but the floor
    assert seen["max_tokens"] == 600
    llm.complete_text("s", [{"role": "user", "content": "short"}], max_tokens=3000)
    assert seen["max_tokens"] == 3000


def test_a_short_groq_rate_limit_is_waited_out_not_abandoned(groq, monkeypatch):
    slept, calls = [], []
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    def post(url, json=None, headers=None, timeout=None):
        calls.append(url)
        req = httpx.Request("POST", url)
        if len(calls) == 1:
            return httpx.Response(429, json=_tpm_429("3.0"), request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "done"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", post)
    assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "done"
    assert llm.provider_name().startswith("Groq") and slept and 3 <= slept[0] <= 4 and all("groq" in u for u in calls)


def test_a_long_groq_rate_limit_moves_to_the_small_model_which_has_its_own_allowance(groq, monkeypatch):
    models = []

    def post(url, json=None, headers=None, timeout=None):
        models.append(json["model"])
        req = httpx.Request("POST", url)
        if json["model"] == "openai/gpt-oss-120b":
            return httpx.Response(429, json=_tpm_429("40.0"), request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "from the small one"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", post)
    assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "from the small one"
    assert models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] and llm.provider_name() == "Groq · openai/gpt-oss-20b"


def test_context_is_trimmed_to_a_groq_minute_only_when_groq_is_on(enabled, monkeypatch):
    from app.services import ai

    text = "word " * 6000
    assert len(ai._trim(text).split()) > 5000  # no Groq: the old generous budget
    monkeypatch.setattr(get_settings(), "groq_api_key", "gsk_test")
    assert len(ai._trim(text).split()) <= ai.GROQ_CONTEXT_WORDS + 1


def test_summary_depths_are_three_different_asks():
    from app.services import ai

    spec = ai._DEPTH_SPEC
    assert set(spec) == {"brief", "standard", "deep"}
    assert "exactly 3" in spec["brief"]["style"] and "outline" in spec["deep"]["style"] and "outline" not in spec["standard"]["style"]
    assert spec["brief"]["tokens"] < spec["standard"]["tokens"] < spec["deep"]["tokens"]


def test_ai_summaries_are_regenerated_every_time(groq, monkeypatch):
    from app.services import ai

    n = {"i": 0}

    def post(url, json=None, headers=None, timeout=None):
        n["i"] += 1
        reply = ('{"main_idea": "take %d", "key_points": ["a", "b", "c", "d"], "concepts": ["x", "y", "z", "w"], "examples": ["e"], '
                 '"takeaways": "t", "suggested_questions": ["q1", "q2", "q3"]}' % n["i"])
        return httpx.Response(200, json={"choices": [{"message": {"content": reply}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", post)
    doc = _fake_doc()
    doc.author = "A"
    first, second = ai.summarize(doc, 0, "standard"), ai.summarize(doc, 0, "standard")
    assert first["main_idea"] != second["main_idea"] and n["i"] == 2
    brief = ai.summarize(doc, 0, "brief")
    assert len(brief["key_points"]) == 3 and brief["examples"] == [] and len(brief["suggested_questions"]) == 2


def test_summary_replies_are_coerced_into_the_shape_the_app_renders():
    from app.services import ai

    messy = {
        "main_idea": "Idea.", "takeaways": {"text": "Remember this."},
        "key_points": [{"point": "A claim", "detail": "with its reason"}, "plain", "", {"x": 1}],
        "concepts": ["a", "b", "c", "d", "e"], "examples": ["e1"], "suggested_questions": ["q1", "q2", "q3"],
        "outline": [{"heading": "One", "summary": "First."}, {"title": "Two", "description": "Second."}] + [{"heading": f"h{i}", "summary": "s"} for i in range(40)],
    }
    deep = ai._normalize_summary(dict(messy), "deep")
    assert all(isinstance(p, str) for p in deep["key_points"]) and deep["key_points"][0] == "A claim — with its reason"
    assert len(deep["outline"]) == 9 and deep["outline"][1] == {"heading": "Two", "summary": "Second."}
    brief = ai._normalize_summary(dict(messy), "brief")
    assert len(brief["key_points"]) == 3 and brief["examples"] == [] and len(brief["suggested_questions"]) == 2 and "outline" not in brief
    with pytest.raises(ValueError):
        ai._normalize_summary({"main_idea": "", "key_points": []}, "standard")


def test_when_both_groq_models_are_spent_it_waits_once_rather_than_leaving_groq(groq, monkeypatch):
    slept, calls = [], []
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    def post(url, json=None, headers=None, timeout=None):
        calls.append(json["model"])
        req = httpx.Request("POST", url)
        if len(calls) <= 2:  # the big model, then the small one: both out of tokens for the minute
            return httpx.Response(429, json=_tpm_429("20.0"), request=req)
        return httpx.Response(200, json={"choices": [{"message": {"content": "finally"}}]}, request=req)

    monkeypatch.setattr(httpx, "post", post)
    assert llm.complete_text("s", [{"role": "user", "content": "q"}]) == "finally"
    assert calls == ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "openai/gpt-oss-20b"] and slept == [pytest.approx(20.4)]
    assert llm.provider_name().startswith("Groq")
