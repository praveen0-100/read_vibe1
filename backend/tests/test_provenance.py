"""Provenance (page mapping, locators, claim verification), overview styles/grounding, job retry and restart recovery."""
import io

from app.database import SessionLocal
from app.models import Audiobook, Chapter, Job
from app.seed import FOCUSED_READING
from app.services import jobs, provenance

DOC_A = (
    "Photosynthesis converts light energy into chemical energy stored in glucose. "
    "The reaction takes place inside chloroplasts and releases oxygen as a by-product.\n\n"
    "Plants absorb about 90 percent of the water they take in through their roots and lose most of it through transpiration.\n\n"
    "Mitochondria are the organelles that release usable energy from glucose during cellular respiration in every cell."
)
DOC_B = "Photosynthesis converts light energy into chemical energy stored in glucose, and plants absorb about 60 percent of the water they take in."


def _text_doc(client, auth, title, content):
    return client.post("/api/documents/text", headers=auth, json={"title": title, "content": content}).json()


def _pdf(pages: list[str]) -> bytes:
    """A tiny valid multi-page PDF whose pages carry the given text (no external libraries)."""
    objs, kids = [], []
    for i, text in enumerate(pages):
        page_id, content_id = 4 + i * 2, 5 + i * 2
        kids.append(f"{page_id} 0 R")
        stream = f"BT /F1 11 Tf 40 760 Td ({text}) Tj ET"
        objs.append((page_id, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>"))
        objs.append((content_id, f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"))
    body = {1: "<< /Type /Catalog /Pages 2 0 R >>", 2: f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>", 3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
    body.update(dict(objs))
    out, offsets = io.BytesIO(), {}
    out.write(b"%PDF-1.4\n")
    for n in sorted(body):
        offsets[n] = out.tell()
        out.write(f"{n} 0 obj\n{body[n]}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(body) + 1}\n0000000000 65535 f \n".encode())
    for n in sorted(body):
        out.write(f"{offsets[n]:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(body) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


# ─── page mapping ─────────────────────────────────────────────────────────────
def test_assign_pages_is_monotonic_and_inherits_when_unmatched():
    from app.services.extraction import ExtractedChapter

    pages = ["Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda", "Second page opens with unique words about orchids and ferns growing wild"]
    ch = ExtractedChapter("C", "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda\n\nSecond page opens with unique words about orchids and ferns growing wild\n\nxx")
    provenance.assign_pages([ch], pages)
    assert ch.paragraph_pages == [1, 2, 2] and (ch.page_start, ch.page_end) == (1, 2)


def test_pdf_import_records_pages_and_locator(client, auth):
    first = "Quantum computers use qubits that can hold superposition states during computation " * 3
    second = "Classical computers rely on bits that are strictly zero or one and cannot superpose " * 3
    pdf = _pdf([first.strip(), second.strip()])
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("q.pdf", pdf, "application/pdf")})
    assert r.status_code == 202, r.text
    doc_id = r.json()["document"]["id"]
    doc = client.get(f"/api/documents/{doc_id}", headers=auth).json()
    assert doc["status"] == "ready"
    ch = client.get(f"/api/documents/{doc_id}/chapters/0", headers=auth).json()
    assert ch["page_start"] == 1 and ch["page_end"] == 2 and ch["paragraph_pages"]
    loc = client.get(f"/api/documents/{doc_id}/locate", headers=auth, params={"chapter": 0, "paragraph": 0}).json()
    assert loc["source_id"] == doc_id and loc["page"] == 1
    assert client.get(f"/api/documents/{doc_id}/locate", headers=auth, params={"chapter": 0, "paragraph": 0}).status_code == 200


def test_text_documents_have_no_pages(client, auth):
    d = _text_doc(client, auth, "Plain", FOCUSED_READING)
    loc = client.get(f"/api/documents/{d['id']}/locate", headers=auth, params={"chapter": 0, "paragraph": 0}).json()
    assert loc["page"] is None and loc["chapter_title"]


# ─── claim verification ───────────────────────────────────────────────────────
def test_verify_claim_grades_support_and_returns_locators(client, auth):
    a = _text_doc(client, auth, "Biology A", DOC_A)
    ok = client.post("/api/research/verify", headers=auth, json={"claim": "Photosynthesis converts light energy into chemical energy stored in glucose", "document_ids": [a["id"]]}).json()
    assert ok["verdict"] == "supported" and ok["evidence"][0]["paragraph_index"] == 0 and ok["evidence"][0]["document_id"] == a["id"]
    bad = client.post("/api/research/verify", headers=auth, json={"claim": "Volcanoes erupt molten granite across the Pacific ocean floor", "document_ids": [a["id"]]}).json()
    assert bad["verdict"] == "unsupported" and bad["evidence"] == []


def test_verify_surfaces_disagreement_instead_of_merging(client, auth):
    a = _text_doc(client, auth, "Source A", DOC_A)
    b = _text_doc(client, auth, "Source B", DOC_B)
    r = client.post("/api/research/verify", headers=auth, json={"claim": "plants absorb about 90 percent of the water they take in", "document_ids": [a["id"], b["id"]]}).json()
    assert len(r["by_source"]) == 2
    assert r["possible_numeric_conflict"] is True and r["sources_disagree"] is True
    assert "not source text" in r["note"]


def test_verify_is_private_and_validated(client, auth, demo):
    a = _text_doc(client, auth, "Mine", DOC_A)
    assert client.post("/api/research/verify", headers=demo, json={"claim": "photosynthesis converts light", "document_ids": [a["id"]]}).status_code == 404
    assert client.post("/api/research/verify", headers=auth, json={"claim": "short", "document_ids": [a["id"]]}).status_code == 422


# ─── overview styles + grounding ──────────────────────────────────────────────
def test_overview_styles_are_cached_separately_and_grounded(client, auth):
    d = _text_doc(client, auth, "Style doc", DOC_A + "\n\n" + FOCUSED_READING)
    outs = {}
    for style in ("deep_dive", "brief", "critique"):
        r = client.post("/api/ai/overview", headers=auth, json={"document_id": d["id"], "language": "en", "format": "narrative", "style": style})
        assert r.status_code == 200, r.text
        outs[style] = r.json()
        assert outs[style]["style"] == style and outs[style]["style_label"]
    v = outs["deep_dive"]["verification"]
    assert v["claim_turns"] >= 1 and v["grounded_turns"] >= 1  # extractive narration is quoted from the document itself
    grounded = [t for t in outs["deep_dive"]["turns"] if t["source_refs"]]
    assert grounded and "paragraph_index" in grounded[0]["source_refs"][0]
    assert client.post("/api/ai/overview", headers=auth, json={"document_id": d["id"], "language": "en", "style": "nope"}).status_code == 422


# ─── jobs: retry + restart recovery ───────────────────────────────────────────
def _audiobook_job(client, auth, status):
    d = _text_doc(client, auth, "Retry me", FOCUSED_READING)
    created = client.post("/api/audio/audiobooks", headers=auth, json={"document_id": d["id"], "tone": "Regular"}).json()
    with SessionLocal() as db:
        job = db.get(Job, created["job_id"])
        book = db.get(Audiobook, created["audiobook"]["id"])
        job.status, book.status, book.script = status, status, []
        db.commit()
        return job.id, book.id


def test_failed_job_can_be_retried_and_finishes_ready(client, auth):
    job_id, book_id = _audiobook_job(client, auth, "failed")
    listed = next(j for j in client.get("/api/jobs", headers=auth).json() if j["id"] == job_id)
    assert listed["retryable"] is True
    r = client.post(f"/api/jobs/{job_id}/retry", headers=auth)
    assert r.status_code == 200 and r.json()["attempts"] == 2
    assert client.get(f"/api/audio/audiobooks/{book_id}", headers=auth).json()["status"] == "ready"
    assert client.post(f"/api/jobs/{job_id}/retry", headers=auth).status_code == 409  # completed jobs are not retryable


def test_cancelled_job_can_be_retried(client, auth):
    job_id, book_id = _audiobook_job(client, auth, "cancelled")
    assert client.post(f"/api/jobs/{job_id}/retry", headers=auth).status_code == 200
    assert client.get(f"/api/audio/audiobooks/{book_id}", headers=auth).json()["status"] == "ready"


def test_job_without_saved_config_reports_not_retryable(client, auth):
    with SessionLocal() as db:
        from app.models import User
        owner = db.query(User).filter(User.email == "reader@example.com").one().id
        job = Job(owner_id=owner, kind="mystery", title="x", status="failed")
        db.add(job)
        db.commit()
        job_id = job.id
    assert client.post(f"/api/jobs/{job_id}/retry", headers=auth).status_code == 422


def test_recover_requeues_resumable_jobs_and_fails_the_rest(client, auth):
    resumable, book_id = _audiobook_job(client, auth, "processing")
    with SessionLocal() as db:
        owner = db.get(Job, resumable).owner_id
        orphan = Job(owner_id=owner, kind="mystery", title="orphan", status="processing")
        db.add(orphan)
        db.commit()
        orphan_id = orphan.id
    out = jobs.recover()
    assert out["requeued"] >= 1 and out["failed"] >= 1
    with SessionLocal() as db:
        assert db.get(Job, orphan_id).status == "failed" and "restart" in db.get(Job, orphan_id).error
        assert db.get(Job, resumable).status == "completed"  # re-run inline in tests
        assert db.get(Audiobook, book_id).status == "ready"


# ─── independent AI-answer language ───────────────────────────────────────────
def test_chosen_reply_language_reaches_the_agent_prompt():
    from app.services.agent import orchestrator

    assert "Tamil" in orchestrator._situation(None, None, None, 0, "ta")
    assert "chose" not in orchestrator._situation(None, None, None, 0, None)
    assert "chose" not in orchestrator._situation(None, None, None, 0, "xx")  # unknown codes are ignored, not guessed


def test_agent_chat_accepts_reply_language(client, auth):
    r = client.post("/api/agent/chat", headers=auth, json={"message": "hello there", "reply_language": "ta"})
    assert r.status_code == 200, r.text
    assert client.post("/api/agent/chat", headers=auth, json={"message": "hello", "reply_language": "x"}).status_code == 422
