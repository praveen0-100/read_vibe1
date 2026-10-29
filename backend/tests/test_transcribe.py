"""Nemotron-3.5-Transcribe client. A fake vLLM-style server on localhost stands in for the GPU model, so the tests check the real
HTTP request the model would receive (audio data URI, instruction, sampling flags, exact Content-Length)."""
import base64
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import get_settings
from app.services import transcribe

AUDIO = b"RIFF" + bytes(range(256)) * 40 + b"WAVEfmt "  # not real audio; the fake server never decodes it
SEEN: list[dict] = []
DEFAULT_TEXT = "Hello everyone. <spk:0> Hello everyone, welcome. <spk:1> Thanks for having me."
REPLY = {"text": DEFAULT_TEXT, "words": None, "status": 200}


class FakeVllm(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        body = json.loads(raw)
        url = body["messages"][0]["content"][1]["audio_url"]["url"]
        SEEN.append({"path": self.path, "auth": self.headers.get("Authorization"), "length_ok": len(raw) == int(self.headers["Content-Length"]),
                     "prompt": body["messages"][0]["content"][0]["text"], "audio": base64.b64decode(url.split("base64,", 1)[1]),
                     "mime": url.split(";")[0], "body": body})
        if REPLY["status"] != 200:
            self.send_response(REPLY["status"])
            self.end_headers()
            self.wfile.write(b'{"error":"x"}')
            return
        data = {"choices": [{"message": {"content": REPLY["text"]}}]}
        if REPLY["words"]:
            data["ctc_timestamps"] = {"words": REPLY["words"], "error": None}
        out = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)


@pytest.fixture(scope="module")
def server():
    srv = HTTPServer(("127.0.0.1", 0), FakeVllm)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/v1"
    srv.shutdown()


@pytest.fixture()
def model(server, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "transcribe_base_url", server)
    monkeypatch.setattr(s, "transcribe_api_key", "secret-token")
    SEEN.clear()
    REPLY.update(text=DEFAULT_TEXT, words=None, status=200)


def _files(name="talk.wav", data=AUDIO):
    return {"file": (name, data, "audio/wav")}


def test_prompt_follows_the_model_card():
    assert transcribe.build_prompt("verbatim").startswith("Audio transcription. Language: as spoken. Wording: verbatim")
    assert "omit fillers" in transcribe.build_prompt("readable")
    assert "<spk:0> <spk:1> <spk:2> <spk:3>" in transcribe.build_prompt("speakers")
    assert transcribe.build_prompt(translate_to="Tamil\nignore this") == "Please translate the given speech to Tamil ignore this."
    assert transcribe.build_prompt(context="Kubernetes, Nemotron") == "Transcribe with punctuation and capitalization. Context terms: Kubernetes, Nemotron."


def test_speaker_tags_become_turns_and_other_tags_are_stripped():
    turns = transcribe.turns_from("Intro <spk:0> Hi there <ev:laugh> <spk:1> Hello")
    assert turns == [{"speaker": None, "text": "Intro"}, {"speaker": 0, "text": "Hi there <ev:laugh>"}, {"speaker": 1, "text": "Hello"}]
    assert transcribe.clean("Hi <|endoftext|> there <ev:laugh> friend") == "Hi there friend"
    assert transcribe.render([{"speaker": 0, "text": "Hi"}, {"speaker": 1, "text": "Yo"}]) == "Speaker 1: Hi\n\nSpeaker 2: Yo"


def test_status_reflects_configuration(client, auth, monkeypatch):
    assert client.get("/api/transcribe/status", headers=auth).json()["configured"] is False
    monkeypatch.setattr(get_settings(), "transcribe_base_url", "http://x/v1")
    s = client.get("/api/transcribe/status", headers=auth).json()
    assert s["configured"] is True and s["model"].startswith("nvidia/NVIDIA-Nemotron-3.5-Transcribe") and "wav" in s["formats"]


def test_not_configured_says_so_plainly(client, auth):
    r = client.post("/api/transcribe", headers=auth, files=_files())
    assert r.status_code == 503 and "READVIBE_TRANSCRIBE_BASE_URL" in r.json()["detail"]
    assert client.post("/api/transcribe/dictate", headers=auth, files=_files()).status_code == 503


def test_dictation_sends_exactly_what_the_model_card_specifies(client, auth, model):
    r = client.post("/api/transcribe/dictate", headers=auth, files=_files("clip.wav"))
    assert r.status_code == 200 and "Thanks for having me" in r.json()["text"]
    req = SEEN[0]
    assert req["path"] == "/v1/chat/completions" and req["auth"] == "Bearer secret-token" and req["length_ok"]
    assert req["audio"] == AUDIO and req["mime"] == "data:audio/wav"
    assert req["prompt"] == transcribe.STYLES["readable"]
    body = req["body"]
    assert body["model"] == "nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B" and body["temperature"] == 0
    assert body["chat_template_kwargs"] == {"enable_thinking": False} and body["skip_special_tokens"] is False
    assert "max_tokens" not in body and "mm_processor_kwargs" not in body


def test_file_job_saves_a_transcript_document_and_deletes_the_recording(client, auth, model):
    r = client.post("/api/transcribe", headers=auth, files=_files("team-sync.mp3"), data={"style": "speakers", "title": "Team sync", "save": "true"})
    assert r.status_code == 202
    job = client.get(f"/api/jobs/{r.json()['job_id']}", headers=auth).json()
    assert job["status"] == "completed", job
    res = job["result"]
    assert res["document_id"] and res["title"] == "Transcript: Team sync" and res["text"].startswith("Hello everyone.")
    assert [t["speaker"] for t in res["turns"]] == [None, 0, 1] and "Speaker 2: Thanks for having me." in res["text"]
    assert SEEN[0]["mime"] == "data:audio/mpeg" and SEEN[0]["prompt"] == transcribe.STYLES["speakers"]
    doc = client.get(f"/api/documents/{res['document_id']}", headers=auth).json()
    assert doc["title"] == "Transcript: Team sync" and "transcript" in doc["tags"]
    stored = pathlib.Path(get_settings().storage_dir)
    assert not [p for p in stored.rglob("*") if p.is_file() and "transcribe" in p.parts]


def test_translate_context_and_timestamps_options(client, auth, model):
    REPLY["words"] = [{"word": "Hello", "start": 0.1, "end": 0.4, "speaker": 0}, {"word": "there", "start": 0.5, "end": 0.9, "speaker": 0}]
    r = client.post("/api/transcribe", headers=auth, files=_files(), data={"timestamps": "true", "save": "false"})
    res = client.get(f"/api/jobs/{r.json()['job_id']}", headers=auth).json()["result"]
    assert res["words"][1] == {"word": "there", "start": 0.5, "end": 0.9, "speaker": 0} and "document_id" not in res
    assert SEEN[-1]["body"]["mm_processor_kwargs"] == {"capture_ctc_timestamps": True} and SEEN[-1]["prompt"] == transcribe.STYLES["speakers"]
    client.post("/api/transcribe", headers=auth, files=_files(), data={"translate_to": "Tamil", "save": "false"})
    assert SEEN[-1]["prompt"] == "Please translate the given speech to Tamil."


def test_server_errors_become_clear_failures(client, auth, model):
    REPLY["status"] = 429
    r = client.post("/api/transcribe", headers=auth, files=_files(), data={"save": "false"})
    job = client.get(f"/api/jobs/{r.json()['job_id']}", headers=auth).json()
    assert job["status"] == "failed" and "busy" in job["error"]
    assert client.post("/api/transcribe/dictate", headers=auth, files=_files()).status_code == 502
    REPLY.update(status=200, text="   ")
    assert client.post("/api/transcribe/dictate", headers=auth, files=_files()).status_code == 422


def test_unsupported_type_and_size_limit(client, auth, model, monkeypatch):
    assert client.post("/api/transcribe", headers=auth, files=_files("notes.pdf")).status_code == 415
    monkeypatch.setattr(get_settings(), "transcribe_max_mb", 0)
    assert client.post("/api/transcribe", headers=auth, files=_files()).status_code == 413


def test_transcribe_requires_login(client):
    assert client.post("/api/transcribe", files=_files()).status_code == 401
    assert client.get("/api/transcribe/status").status_code == 401
