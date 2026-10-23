"""Stage directions are performed, not read: stripped from speech, turned into delivery, never leaked by the AI."""
import pytest

from app.services import directions, llm, narration, tts

PLAY = (
    "willy [directly to biff]: You vengeful, spiteful mut! [biff breaks from happy. willy, in fright, starts up the stairs. "
    "biff grabs him. ] biff [at the peak of his fury ]: Pop, I’m nothing! [biff’s fury has spent itself, and he breaks down, "
    "sobbing.] willy [astonished]: What’re you doing? See note [3, 4]."
)


def test_directions_never_reach_speech():
    spoken = directions.strip_for_speech(PLAY)
    assert "[" not in spoken and "]" not in spoken
    for leaked in ("directly to biff", "breaks from happy", "in fright", "peak of his fury", "sobbing", "astonished", "3, 4"):
        assert leaked not in spoken
    assert "You vengeful, spiteful mut!" in spoken and "Pop, I’m nothing!" in spoken and "What’re you doing?" in spoken
    # brackets split across sentences/segments still vanish
    assert directions.strip_for_speech("[biff breaks from happy.") == ""
    assert directions.strip_for_speech("grabs him. ] biff: Pop") == "biff: Pop"
    assert directions.strip_for_speech("") == ""


def test_audiobook_script_skips_directions():
    script, _ = narration.build_script([(0, "Act II", PLAY)], "Regular")
    body = " ".join(s["text"] for s in script[0]["segments"] if s["kind"] == "text")
    assert "[" not in body and "in fright" not in body and "vengeful" in body


def test_prosody_acts_the_emotion_and_the_punctuation():
    assert tts.prosody("Hello there.", None) == ("+0%", "+0Hz", "+0%")
    fright = tts.prosody("Pop, wait.", "fright")
    assert int(fright[0][:-1]) > 10 and int(fright[1][:-2]) > 5            # faster and higher
    sad = tts.prosody("It is over.", "sad")
    assert int(sad[0][:-1]) < -8 and int(sad[2][:-1]) < 0                  # slower and quieter
    assert int(tts.prosody("Are you sure?", "neutral")[1][:-2]) == 3         # a question lifts the pitch
    loud = tts.prosody("Get out!", "angry")
    assert int(loud[2][:-1]) > int(tts.prosody("Get out.", "angry")[2][:-1])  # an exclamation is louder
    assert tts.prosody("x", "neutral", shift=-6)[1] == "-6Hz"               # characters are kept apart by pitch
    assert tts.prosody("x", "no-such-feeling") == tts.prosody("x", "neutral")
    for e in tts.EMOTIONS:
        r, p, v = tts.prosody("A line of text.", e, 20)
        assert -40 <= int(r[:-1]) <= 40 and -30 <= int(p[:-2]) <= 30 and -50 <= int(v[:-1]) <= 30


def test_tts_endpoint_delivers_emotion_and_caches_per_delivery(client, auth, monkeypatch):
    seen = []

    async def fake_edge(text, voice, delivery):
        seen.append(delivery)
        return b"ID3fake", tts._align(text, [(0, 200, text.split()[0])]), "ms"

    monkeypatch.setattr(tts, "_edge", fake_edge)
    base = {"text": "I am nothing, Pop.", "voice": "edge:en-US-AndrewMultilingualNeural"}
    for extra in ({}, {"emotion": "sad"}, {"emotion": "sad", "pitch_shift": -6}, {"emotion": "sad"}):
        assert client.post("/api/tts/synthesize", headers=auth, json={**base, **extra}).status_code == 200
    assert len(seen) == 3 and seen[0] == ("+0%", "+0Hz", "+0%") and seen[1][0].startswith("-") and seen[2][1] == "-10Hz"  # last repeat was cached
    assert client.post("/api/tts/synthesize", headers=auth, json={**base, "pitch_shift": 99}).status_code == 422


def test_overview_never_speaks_bracketed_notes_and_keeps_emotion(client, auth, monkeypatch):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("play.txt", (PLAY + "\n\n" + PLAY).encode(), "text/plain")})
    doc_id = r.json()["document"]["id"]
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", lambda *a, **k: {"title": "A father and son", "turns": [
        {"speaker": "host_a", "text": "Let’s talk about the big argument [pause for effect] in the play.", "emotion": "curious"},
        {"speaker": "host_b", "text": "It breaks Biff open (voice cracking).", "emotion": "sad"},
        {"speaker": "host_a", "text": "Hmm.", "emotion": "not-a-real-emotion"},
    ]})
    out = client.post("/api/ai/overview", headers=auth, json={"document_id": doc_id, "language": "en", "format": "conversation"}).json()
    assert out["turns"][0]["text"] == "Let’s talk about the big argument in the play."
    assert [t["emotion"] for t in out["turns"]] == ["curious", "sad", "neutral"]


BOOK = (
    "A critical introduction.\n\nLinda Loman is Willy’s loyal wife. Linda is tough. She is a fighter, and she defines herself through him. "
    "Biff, his son, is lost. Willy sees himself in Biff. Mr. Charley is generous. Miss Forsythe waits at the bar."
)


def test_cast_hints_come_from_the_text_never_the_name():
    from app.services import cast

    h = cast.hints(BOOK, ["linda", "willy", "biff", "charley", "miss forsythe", "young linda", "the woman", "stranger", "zed"])
    assert h["linda"] == "female"                 # "Willy’s … wife" + "She is a fighter"
    assert h["willy"] == "male"                   # owner of a wife
    assert h["biff"] == "male"                    # "Biff, his son"
    assert h["miss forsythe"] == "female"         # the label itself is a title
    assert h["young linda"] == "female"           # a modifier doesn't hide the person
    assert h["the woman"] == "female"             # role noun
    assert h["stranger"] is None and h["zed"] is None  # no evidence → undecided, not guessed


def test_cast_endpoint_reads_the_whole_document(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("intro.txt", (BOOK * 3).encode(), "text/plain")})
    doc_id = r.json()["document"]["id"]
    out = client.post(f"/api/documents/{doc_id}/cast", headers=auth, json={"names": ["linda", "biff", "nobody"]}).json()["hints"]
    assert out == {"linda": "female", "biff": "male", "nobody": None}
    assert client.post(f"/api/documents/{doc_id}/cast", json={"names": ["x"]}).status_code == 401
