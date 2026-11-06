"""OCR for scanned PDFs, the knowledge graph, presenter Q&A, and a small reproducible quality benchmark."""
import pytest

from app.services import ocr
from tests.test_provenance import DOC_A, DOC_B, _pdf, _text_doc

SCAN_TEXT = ("Scanned page about glaciers and how slowly large ice sheets move across mountain valleys over many centuries. " * 3).strip()


@pytest.fixture
def fake_ocr():
    ocr.set_engine(lambda source, max_pages, languages: [SCAN_TEXT, SCAN_TEXT.replace("glaciers", "icebergs")])
    yield
    ocr.set_engine(None)


# ─── OCR ──────────────────────────────────────────────────────────────────────
def test_scanned_pdf_without_engine_explains_what_is_missing(client, auth):
    ocr.set_engine(None)
    scanned = _pdf(["", ""])  # pages with no text layer
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("scan.pdf", scanned, "application/pdf")})
    doc = client.get(f"/api/documents/{r.json()['document']['id']}", headers=auth).json()
    assert doc["status"] == "failed" and "OCR" in doc["error"] and "Tesseract" in doc["error"]


def test_scanned_pdf_is_imported_through_the_ocr_engine(client, auth, fake_ocr):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("scan.pdf", _pdf(["", ""]), "application/pdf")})
    doc = client.get(f"/api/documents/{r.json()['document']['id']}", headers=auth).json()
    assert doc["status"] == "ready" and "OCR" in doc["description"]
    ch = client.get(f"/api/documents/{doc['id']}/chapters/0", headers=auth).json()
    assert "glaciers" in ch["content"] and ch["page_start"] == 1 and ch["page_end"] == 2  # OCR pages feed the page mapping too


def test_ocr_failures_never_crash_the_import(client, auth):
    def boom(*_):
        raise RuntimeError("engine exploded")

    ocr.set_engine(boom)
    try:
        r = client.post("/api/documents/upload", headers=auth, files={"file": ("scan2.pdf", _pdf(["", ""]), "application/pdf")})
        assert r.status_code == 202
        assert client.get(f"/api/documents/{r.json()['document']['id']}", headers=auth).json()["status"] == "failed"
    finally:
        ocr.set_engine(None)


# ─── knowledge graph ──────────────────────────────────────────────────────────
def test_graph_links_concepts_with_locators_and_marks_shared_ones(client, auth):
    a = _text_doc(client, auth, "Graph A", DOC_A)
    b = _text_doc(client, auth, "Graph B", DOC_B)
    g = client.post("/api/research/graph", headers=auth, json={"document_ids": [a["id"], b["id"]]}).json()
    assert g["nodes"] and {d["id"] for d in g["documents"]} == {a["id"], b["id"]}
    for n in g["nodes"]:
        assert n["evidence"] and n["evidence"][0]["source_id"] in n["sources"]
    shared = [n for n in g["nodes"] if n["shared"]]
    assert shared and all(len(n["sources"]) == 2 for n in shared)
    ids = {n["id"] for n in g["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids and e["evidence"] for e in g["edges"])
    assert "not that they are proven" in g["note"]


def test_graph_is_private_and_validated(client, auth, demo):
    a = _text_doc(client, auth, "Private graph", DOC_A)
    assert client.post("/api/research/graph", headers=demo, json={"document_ids": [a["id"]]}).status_code == 404
    assert client.post("/api/research/graph", headers=auth, json={"document_ids": []}).status_code == 422


# ─── presenter Q&A ────────────────────────────────────────────────────────────
def _deck(client, auth, doc):
    r = client.post("/api/decks", headers=auth, json={"document_id": doc["id"], "slides": 6, "images": False})
    assert r.status_code == 202, r.text
    return client.get(f"/api/decks/{r.json()['deck']['id']}", headers=auth).json()


def test_presenter_answers_from_source_with_citations_and_admits_gaps(client, auth):
    doc = _text_doc(client, auth, "Plants deck", DOC_A + "\n\n" + DOC_A.replace("Photosynthesis", "Respiration"))
    deck = _deck(client, auth, doc)
    ok = client.post(f"/api/decks/{deck['id']}/ask", headers=auth, json={"question": "Where does photosynthesis take place?", "slide_index": 0}).json()
    assert ok["grounded"] is True and "chloroplast" in ok["answer"].lower()
    assert ok["citations"] and ok["citations"][0]["source_id"] == doc["id"] and "paragraph_index" in ok["citations"][0]
    gap = client.post(f"/api/decks/{deck['id']}/ask", headers=auth, json={"question": "How tall is the Eiffel tower in metres?"}).json()
    assert gap["grounded"] is False and gap["citations"] == [] and "doesn" in gap["answer"]


def test_presenter_qa_is_private_and_validated(client, auth, demo):
    doc = _text_doc(client, auth, "Mine deck", DOC_A)
    deck = _deck(client, auth, doc)
    assert client.post(f"/api/decks/{deck['id']}/ask", headers=demo, json={"question": "what is this?"}).status_code == 404
    assert client.post(f"/api/decks/{deck['id']}/ask", headers=auth, json={"question": "hi"}).status_code == 422


# ─── quality benchmark (reproducible; measures this engine, no claims beyond the fixture) ───
BENCH_DOC = (
    "The Treaty of Westphalia in 1648 ended the Thirty Years War across central Europe.\n\n"
    "Printing presses spread rapidly after Gutenberg introduced movable metal type around 1450.\n\n"
    "The Hanseatic League dominated Baltic trade through allied merchant cities during the late medieval period.\n\n"
    "Copernicus proposed a heliocentric model placing the sun near the centre of the universe in 1543.\n\n"
    "The Black Death killed roughly a third of the European population in the fourteenth century."
)
# (claim, expected paragraph index or None when the claim is fabricated)
BENCH = [
    ("The Treaty of Westphalia in 1648 ended the Thirty Years War", 0),
    ("Gutenberg introduced movable metal type around 1450 and printing spread", 1),
    ("The Hanseatic League dominated Baltic trade through merchant cities", 2),
    ("Copernicus proposed a heliocentric model with the sun near the centre", 3),
    ("The Black Death killed about a third of the European population", 4),
    ("Napoleon conquered Australia using steam powered submarines", None),
    ("Quantum teleportation was demonstrated by medieval monks", None),
    ("Vikings built the first skyscraper in Antarctica", None),
]


def test_benchmark_citation_correctness_and_faithfulness(client, auth):
    d = _text_doc(client, auth, "Bench", BENCH_DOC)
    correct = false_support = 0
    real = [b for b in BENCH if b[1] is not None]
    fake = [b for b in BENCH if b[1] is None]
    for claim, expected in real:
        r = client.post("/api/research/verify", headers=auth, json={"claim": claim, "document_ids": [d["id"]]}).json()
        if r["verdict"] in ("supported", "partial") and r["evidence"] and r["evidence"][0]["paragraph_index"] == expected:
            correct += 1
    for claim, _ in fake:
        r = client.post("/api/research/verify", headers=auth, json={"claim": claim, "document_ids": [d["id"]]}).json()
        if r["verdict"] == "supported":
            false_support += 1
    citation_correctness = correct / len(real)
    # Targets from the product spec are 98% / 95% on a large labelled set; this fixture only guards against regressions.
    assert citation_correctness >= 0.8, citation_correctness
    assert false_support == 0, "fabricated claims must never be graded as supported"


# ─── original view for DOCX / text ────────────────────────────────────────────
def test_render_original_docx_and_text(client, auth):
    import io

    import docx

    d = docx.Document()
    d.add_heading("Chapter One", level=1)
    d.add_paragraph("A paragraph of original text.")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text, t.rows[0].cells[1].text = "A", "B"
    buf = io.BytesIO()
    d.save(buf)
    up = client.post("/api/documents/upload", headers=auth, files={"file": ("o.docx", buf.getvalue(), "application/octet-stream")}).json()["document"]
    out = client.get(f"/api/documents/{up['id']}/render", headers=auth).json()
    kinds = [b["type"] for b in out["blocks"]]
    assert kinds[:2] == ["heading", "paragraph"] and "table" in kinds and out["blocks"][0]["text"] == "Chapter One"
    assert client.get(f"/api/documents/{up['id']}", headers=auth).json()["has_original_view"] is True

    md = client.post("/api/documents/upload", headers=auth, files={"file": ("n.md", b"# Title\n\nBody text here is long enough to be a paragraph of the notes.\n", "text/markdown")}).json()["document"]
    blocks = client.get(f"/api/documents/{md['id']}/render", headers=auth).json()["blocks"]
    assert blocks[0] == {"type": "heading", "level": 1, "text": "Title"}


def test_render_is_unavailable_for_pasted_text_and_other_users(client, auth, demo):
    pasted = _text_doc(client, auth, "Pasted", DOC_A)
    assert client.get(f"/api/documents/{pasted['id']}/render", headers=auth).status_code == 404
    up = client.post("/api/documents/upload", headers=auth, files={"file": ("p.txt", DOC_A.encode(), "text/plain")}).json()["document"]
    assert client.get(f"/api/documents/{up['id']}/render", headers=demo).status_code == 404
