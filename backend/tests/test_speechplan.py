"""Universal multilingual TTS contract: language runs, delivery controls, glossary, fidelity and validation."""
from app.services import speechplan, tts


def test_markup_is_never_spoken_but_wording_is_kept():
    assert speechplan.sanitize("Hello <break time='1s'/> **world** <b>now</b>, a < b") == "Hello world now, a < b"


def test_code_switching_splits_by_language_but_names_stay_put():
    ta = "இது ஒரு சோதனை வாக்கியம் ஆகும்"
    out = speechplan.runs(f"{ta} this is plain English text {ta}")
    assert [r.lang for r in out] == ["ta", "en", "ta"]
    one = speechplan.runs(f"{ta} ReadVibe {ta}")           # a product name does not flip the voice
    assert [r.lang for r in one] == ["ta"]


def test_style_deltas_combine_and_unknowns_are_neutral():
    assert speechplan.style("slow", "low", "precise")[0] < speechplan.style("brisk", "high", "casual")[0]
    assert speechplan.style("nonsense", None, "") == (0, 0, 0)
    fast = tts.prosody("Hello there.", None, 0, speechplan.style("brisk"))
    assert int(fast[0][:-1]) > 0


def test_glossary_changes_sound_only_and_whole_words():
    assert speechplan.apply_glossary("US and us, USA", {"US": "you ess"}) == "you ess and us, USA"


def test_voice_for_wrong_language_is_replaced_with_a_note():
    voice, note = speechplan.resolve_voice("edge:en-IN-NeerjaNeural", "ta")
    assert voice.startswith("edge:ta-IN") and note
    assert speechplan.resolve_voice("edge:en-IN-NeerjaNeural", "en") == ("edge:en-IN-NeerjaNeural", None)
    assert speechplan.resolve_voice("openai:coral", "ta") == ("openai:coral", None)   # multilingual: untouched
    keep, why = speechplan.resolve_voice("edge:en-IN-NeerjaNeural", "pa")             # no Punjabi voice exists
    assert keep == "edge:en-IN-NeerjaNeural" and "No Punjabi voice" in why


def test_audio_validation_and_review_flags():
    assert speechplan.check_audio(b"") and speechplan.check_audio(b"RIFFxxxx")
    assert speechplan.check_audio(b"ID3\x04") is None and speechplan.check_audio(b"\xff\xfbabc") is None
    assert speechplan.review_flags("Due 03/04/2025.") and not speechplan.review_flags("Due 12/12/2025.")


def test_mixed_language_text_is_voiced_per_language_with_joined_timings(client, auth, monkeypatch):
    seen = []

    async def fake_edge(text, voice, delivery, shown=None):
        seen.append((voice, text))
        words = [(0, 100, w) for w in text.split()]
        return b"ID3x", tts._align(shown or text, [(i * 100, 100, w) for i, (_, _, w) in enumerate(words)]), "ms"

    monkeypatch.setattr(tts, "_edge", fake_edge)
    ta = "இது ஒரு சோதனை வாக்கியம் ஆகும்"
    r = client.post("/api/tts/synthesize", headers=auth, json={"text": f"{ta} this is plain English text", "voice": "edge:ta-IN-PallaviNeural", "pace": "slow", "glossary": {"plain": "plane"}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [s["language"] for s in out["segments"]] == ["ta", "en"]
    assert out["segments"][1]["voice"].startswith("edge:en") and any("different language" in n for n in out["notes"])
    assert ("edge:en" in seen[1][0] or seen[1][0].startswith("en-")) and "plane" in seen[1][1]   # respelled for the engine only
    starts = [w[2] for w in out["words"]]
    assert starts == sorted(starts)                                                    # joins keep timings monotonic


def test_human_texture_is_deterministic_but_varied():
    a = speechplan.human_delta("The tide came in slowly.")
    assert a == speechplan.human_delta("The tide came in slowly.")
    assert len({speechplan.human_delta(f"Sentence number {i} here.") for i in range(30)}) > 5     # not one cadence repeated
    start, end = speechplan.human_delta("Same words.", "start"), speechplan.human_delta("Same words.", "end")
    assert start[0] > end[0] and start[1] > end[1] and end[2] < start[2]                          # opens up, settles down
    assert speechplan.human_delta("“Come here,” she said.")[1] >= speechplan.human_delta("Come here she said.")[1]


def test_conversations_get_listener_reactions_but_not_at_the_end():
    from app.services import overview
    long = "x" * 200
    turns = [{"speaker": "host_a" if i % 2 == 0 else "host_b", "text": long, "voice": None, "emotion": "neutral"} for i in range(8)]
    out = overview.humanise(turns, "en")
    reactions = [t for t in out if t.get("reaction")]
    assert reactions and not out[-1].get("reaction")
    assert all(out[i - 1]["speaker"] != r["speaker"] for i, r in enumerate(out) if r.get("reaction"))   # the other host reacts
    assert overview.humanise(turns, "xx") == turns                                                       # unknown language: untouched


def test_symbols_become_pauses_without_changing_length():
    for text in ("Wait — what? Yes… or no... it's fine -- really. • item ★ done", "A - B", "plain sentence."):
        out = speechplan.speakable(text)
        assert len(out) == len(text)                                                       # offsets still line up with the transcript
    assert speechplan.speakable("Wait — what") == "Wait , what"
    assert "•" not in speechplan.speakable("• item") and "★" not in speechplan.speakable("done ★")
    assert speechplan.speakable("A - B") == "A , B" and speechplan.speakable("well-known") == "well-known"
    assert speechplan.speakable("Plain text, kept.") == "Plain text, kept."


def test_engine_receives_pauses_but_timings_stay_on_the_original_text(client, auth, monkeypatch):
    from app.services import tts

    sent = []

    async def fake_edge(text, voice, delivery, shown=None):
        sent.append((text, shown))
        words = [(0, 200, "Hello"), (400, 200, "world")]
        return b"ID3x", tts._align(shown or text, words), "ms"

    monkeypatch.setattr(tts, "_edge", fake_edge)
    r = client.post("/api/tts/synthesize", headers=auth, json={"text": "Hello — world", "voice": "edge:en-IN-NeerjaNeural"})
    assert r.status_code == 200, r.text
    assert sent[0][0] == "Hello , world" and sent[0][1] == "Hello — world"                 # voiced with a pause, aligned to the real text
    assert r.json()["words"] == [[0, 5, 0, 200], [8, 5, 400, 200]]
