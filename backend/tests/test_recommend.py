from datetime import datetime, timezone
from types import SimpleNamespace as NS

from app.services import recommend


def doc(i, title, tags=(), desc="", progress=0, favorite=False, opened=False):
    return NS(id=i, title=title, tags=list(tags), description=desc, status="ready", progress=progress, favorite=favorite, pinned=False,
              last_opened_at=datetime.now(timezone.utc) if opened else None)


def test_documents_are_categorised_and_noise_falls_to_general():
    assert recommend.categorise(doc("a", "Everyday Design Principles", ["UX", "Design"]))[0] == "tech"
    assert recommend.categorise(doc("b", "The Double Thirteen", ["Project Gutenberg"], "A detective hunts a murderer"))[0] == "mystery"
    assert recommend.categorise(doc("c", "Misc", ["Project Gutenberg"]))[0] == "general"


def test_interests_follow_reading_and_related_books_explain_why():
    docs = [
        doc("1", "The Face at the Window", ["Mystery"], "A detective story of murder", progress=60, opened=True),
        doc("2", "The Midnight Visit", ["Detective"], "A murder and a detective at midnight"),
        doc("3", "Principles of UX Design", ["UX", "Design"], "Usability and software design"),
        doc("4", "Finished Mystery", ["Mystery"], "detective", progress=100, opened=True),
    ]
    out = recommend.build(docs)
    assert out["interests"][0]["id"] == "mystery" and out["interests"][0]["topic"] == "detective"
    rel = {r["doc_id"]: r for r in out["related"]}
    assert "2" in rel and rel["2"]["because"]["doc_id"] in ("1", "4") and rel["2"]["reason"]
    assert "4" not in rel and "1" not in {k for k, r in rel.items() if r["because"]["doc_id"] == "1"}  # finished / self never suggested
    assert any(c["id"] == "tech" and c["doc_ids"] == ["3"] for c in out["categories"])


def test_indic_documents_get_their_own_language_group():
    out = recommend.build([doc("t", "தமிழ் இலக்கியம் கதைகள்", desc="இது ஒரு சோதனை வாக்கியம் ஆகும்")])
    assert any(c["id"] == "lang-ta" for c in out["categories"])


def test_recommendations_endpoint(client, auth):
    r = client.get("/api/documents/recommendations", headers=auth)
    assert r.status_code == 200
    assert set(r.json()) == {"categories", "interests", "related", "assignments"}
    assert client.get("/api/documents/recommendations").status_code == 401
