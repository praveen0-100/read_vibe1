"""Indian-language support: detection, voice catalogue priority, native Audio Overview, Indic-aware text processing."""
import pytest

from app.services import languages, llm, nlp, tts

TAMIL = (
    "தமிழ் மொழி மிகவும் பழமையானது. அது இனிமையான மொழி. இந்த நூல் அதைப் பற்றியது.\n\n"
    "படிப்பது ஒரு பழக்கம். தினமும் சிறிது நேரம் படித்தால் அறிவு வளரும். கவனம் ஒரு தசை போன்றது.\n\n"
    "புத்தகங்கள் நமக்கு வழிகாட்டிகள். அவை நம்மை புதிய உலகங்களுக்கு அழைத்துச் செல்கின்றன."
)


@pytest.mark.parametrize("text,code", [
    ("வணக்கம்! இது ஒரு சோதனை உரை. இது தமிழ்.", "ta"),
    ("నమస్కారం ఇది తెలుగు పాఠ్యం", "te"),
    ("ഇത് മലയാളം ആണ്. ഒരു പരീക്ഷണം.", "ml"),
    ("ಇದು ಕನ್ನಡ ಪಠ್ಯ. ಒಂದು ಪರೀಕ್ಷೆ.", "kn"),
    ("यह हिंदी का पाठ है और यह बहुत अच्छा है", "hi"),
    ("हे मराठी पुस्तक आहे आणि ते चांगले आहे", "mr"),
    ("Plain English text, nothing else.", "en"),
    ("An English sentence with one தமிழ் word inside a much longer English paragraph of text.", "en"),
    ("", "en"),
])
def test_detect_by_script(text, code):
    assert languages.detect(text) == code


def test_southern_languages_come_first_everywhere():
    assert [lang.code for lang in languages.LANGUAGES][:4] == ["ta", "te", "ml", "kn"]
    assert list(languages.SOUTHERN) == ["ta", "te", "ml", "kn"]
    featured = [v["lang"] for v in tts.voices() if v["featured"]]
    assert featured[:8] == ["ta", "ta", "te", "te", "ml", "ml", "kn", "kn"]
    assert featured.index("en") > featured.index("hi")  # English voices follow the Indian languages


def test_language_catalogue_endpoint(client, auth):
    cat = client.get("/api/tts/languages", headers=auth).json()
    assert [c["code"] for c in cat[:4]] == ["ta", "te", "ml", "kn"]
    tamil = cat[0]
    assert tamil["native"] == "தமிழ்" and tamil["has_voice"] and len(tamil["voices"]) == 2 and tamil["sample"]
    assert next(c for c in cat if c["code"] == "pa")["has_voice"] is False


def test_nlp_handles_indic_text():
    # combining vowel signs must not split words; sentences end at '.' and the danda '।'
    assert nlp.words("தமிழ் மொழி")[:2] == ["தமிழ்", "மொழி"]
    assert len(nlp.sentences(TAMIL)) == 8
    assert len(nlp.sentences("यह किताब बहुत अच्छी है। हम इसे रोज पढ़ते हैं। यह सबके लिए है।")) == 3
    assert nlp.summarize(TAMIL, "தமிழ்")["main_idea"]


def _upload_tamil(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("tamil.txt", TAMIL.encode("utf-8"), "text/plain")})
    assert r.status_code == 202, r.text
    return r.json()["document"]["id"]


def test_overview_in_native_language_with_two_voices(client, auth, monkeypatch):
    doc_id = _upload_tamil(client, auth)
    captured = {}

    def fake_json(system, prompt, schema, max_tokens=6000):
        captured["prompt"] = prompt
        return {"title": "கவனத்தின் கதை", "turns": [
            {"speaker": "host_a", "text": "வணக்கம்! இன்று நாம் ஒரு சுவாரஸ்யமான தலைப்பைப் பற்றிப் பேசப்போகிறோம்."},
            {"speaker": "host_b", "text": "ஆமாம், கவனம் ஒரு தசை போன்றது என்று இந்த நூல் சொல்கிறது."},
            {"speaker": "narrator", "text": "எனவே தினமும் சிறிது நேரம் படியுங்கள்."},
        ]}

    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_json)
    r = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "ta", "format": "conversation"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["language"] == "ta" and out["native"] == "தமிழ்" and out["format"] == "conversation"
    assert [t["speaker"] for t in out["turns"]] == ["host_a", "host_b", "host_b"]  # a stray "narrator" becomes the second host
    assert out["turns"][0]["voice"] == "edge:ta-IN-PallaviNeural" and out["turns"][1]["voice"] == "edge:ta-IN-ValluvarNeural"
    assert set(out["hosts"]) == {"host_a", "host_b"}
    assert "தமிழ் (தமிழ்)" in captured["prompt"] or "Tamil (தமிழ்)" in captured["prompt"]

    # a second request is served from the disk cache — no new AI call
    monkeypatch.setattr(llm, "complete_json", lambda *a, **k: pytest.fail("cache miss"))
    assert client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "ta", "format": "conversation"}).json()["title"] == out["title"]

    # narrative format: one storyteller, whatever speaker labels the model used
    monkeypatch.setattr(llm, "complete_json", lambda *a, **k: {"title": "ஒரு கதை", "turns": [
        {"speaker": "host_a", "text": "ஒரு காலத்தில் கவனம் என்பது ஒரு தசை என்று யாரும் அறிந்திருக்கவில்லை."},
        {"speaker": "narrator", "text": "பிறகு ஒரு நூல் அதைச் சொன்னது."},
    ]})
    nar = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "ta", "format": "narrative"})
    assert nar.status_code == 200, nar.text
    body = nar.json()
    assert {t["speaker"] for t in body["turns"]} == {"narrator"} and set(body["hosts"]) == {"narrator"}
    assert body["turns"][0]["voice"] == "edge:ta-IN-PallaviNeural"


def test_overview_without_ai_key(client, auth, monkeypatch):
    doc_id = _upload_tamil(client, auth)
    monkeypatch.setattr(llm, "available", lambda: False)
    # the document is already Tamil: narrated from its own sentences
    own = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "ta", "format": "conversation"})
    assert own.status_code == 200 and own.json()["engine"] == "local" and own.json()["format"] == "narrative"
    # another language, no AI key: the key points are translated with the free service (faked here) — no key needed
    from app.services import translate

    calls = []

    def fake_many(texts, target, source="en"):
        calls.append((target, source, len(texts)))
        return [f"తెలుగు {i} {t[:20]}" for i, t in enumerate(texts)]

    monkeypatch.setattr(translate, "translate_many", fake_many)
    te = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "te", "format": "conversation"})
    assert te.status_code == 200, te.text
    out = te.json()
    assert out["engine"] == "free translation" and out["format"] == "conversation" and "Free mode" in out["note"]
    assert {t["speaker"] for t in out["turns"]} == {"host_a", "host_b"}
    assert out["turns"][0]["voice"] == "edge:te-IN-ShrutiNeural" and out["turns"][1]["voice"] == "edge:te-IN-ShrutiNeural"
    assert any(t["voice"] == "edge:te-IN-MohanNeural" for t in out["turns"])
    assert out["turns"][0]["emotion"] == "warm" and out["turns"][-1]["emotion"] == "warm"      # greeting and goodbye are warm
    assert calls[0][:2] == ("te", "ta") and calls[1][:2] == ("te", "en")                     # content from the doc's language, hosts' lines from English

    # the free allowance runs out: a clear message, never silence or English
    def over(texts, target, source="en"):
        raise translate.TranslateError("used up", quota=True)

    monkeypatch.setattr(translate, "translate_many", over)
    full = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "kn", "format": "narrative"})
    assert full.status_code == 503 and "daily limit" in full.json()["detail"] and "AI key" in full.json()["detail"]
    # no neural voice for Punjabi yet
    assert client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "pa"}).status_code == 422
    assert client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "zz"}).status_code == 422


def test_indian_language_chapter_headings_split_documents(client, auth):
    body = (
        "அத்தியாயம் 1: படிப்பின் அழகு\n\n" + "படிப்பது ஒரு அமைதியான பயணம். " * 12 + "\n\n"
        "அத்தியாயம் 2: கவனத்தின் ரகசியம்\n\n" + "கவனம் ஒரு தசை போன்றது. " * 12 + "\n\n"
        "अध्याय 3: पढ़ने की आदत\n\n" + "रोज़ पढ़ना एक अच्छी आदत है। " * 12
    )
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("chapters.txt", body.encode("utf-8"), "text/plain")})
    doc = client.get(f"/api/documents/{r.json()['document']['id']}", headers=auth).json()
    assert doc["chapter_count"] == 3
    assert [c["title"] for c in doc["chapters"]][:2] == ["அத்தியாயம் 1: படிப்பின் அழகு", "அத்தியாயம் 2: கவனத்தின் ரகசியம்"]


# ─── free translation ─────────────────────────────────────────────────────────
def test_translate_caches_verifies_script_and_falls_back(monkeypatch):
    from app.services import translate

    calls = []

    def lazy(text, source, target):  # a provider that hands the English back
        calls.append("lazy")
        return text

    def good(text, source, target):
        calls.append("good")
        return "கவனம் ஒரு தசை போன்றது."

    monkeypatch.setattr(translate, "PROVIDERS", (lazy, good))
    assert translate.translate_one("Attention is a muscle, truly unique 1.", "ta") == "கவனம் ஒரு தசை போன்றது."
    assert calls == ["lazy", "good"]                                   # untranslated output was rejected, the next provider used
    assert translate.translate_one("Attention is a muscle, truly unique 1.", "ta") == "கவனம் ஒரு தசை போன்றது."
    assert calls == ["lazy", "good"]                                   # second time: from the disk cache, no request
    assert translate.translate_one("Same language.", "en") == "Same language."

    monkeypatch.setattr(translate, "PROVIDERS", (lazy,))
    with pytest.raises(translate.TranslateError) as err:
        translate.translate_one("A brand new unique sentence 22.", "ta")
    assert not err.value.quota

    def broke(text, source, target):
        raise translate.TranslateError("used up", quota=True)

    monkeypatch.setattr(translate, "PROVIDERS", (broke,))
    with pytest.raises(translate.TranslateError) as err:
        translate.translate_one("Another brand new unique sentence 333.", "ta")
    assert err.value.quota


def test_translate_many_keeps_order_and_splits_long_text(monkeypatch):
    from app.services import translate

    seen = []

    def echo(text, source, target):
        seen.append(len(text))
        return "தமிழ் மொழி வணக்கம் உலகம் " + text[:3]

    monkeypatch.setattr(translate, "PROVIDERS", (echo,))
    out = translate.translate_many(["First unique sentence aaa.", "Second unique sentence bbb.", ("Long sentence number ccc, " * 40).strip()], "ta")
    assert out[0].endswith("Fir") and out[1].endswith("Sec")
    assert all(n <= translate.MAX_CHARS for n in seen)                  # long text is cut so every request stays small
