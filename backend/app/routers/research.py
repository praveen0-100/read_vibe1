"""Research Studio endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Document, Reference, ResearchProject
from ..schemas import (
    DiscoverIn,
    ExportIn,
    ReferenceCreate,
    ReferenceUpdate,
    ResearchCreate,
    ResearchUpdate,
    SectionAction,
    SectionEdit,
)
from ..serializers import SECTION_KEYS, reference_out, research_out
from ..services import nlp, research, storage

router = APIRouter(prefix="/research", tags=["research"])
MAX_VERSIONS = 12


def _project(db, user, project_id: str) -> ResearchProject:
    return get_owned(db, ResearchProject, user, project_id, "Project")


def _source_text(db, user, project: ResearchProject) -> str:
    parts = []
    for doc_id in project.source_document_ids or []:
        doc = db.get(Document, doc_id)
        if doc and doc.owner_id == user.id:
            parts.append("\n\n".join(c.content for c in doc.chapters))
    return "\n\n".join(parts)


@router.get("")
def list_projects(user: CurrentUser, db: DB):
    rows = db.scalars(select(ResearchProject).where(ResearchProject.owner_id == user.id).order_by(ResearchProject.updated_at.desc()))
    return [research_out(p, full=False) for p in rows]


@router.post("", status_code=201)
def create_project(body: ResearchCreate, user: CurrentUser, db: DB):
    for doc_id in body.source_document_ids:
        get_owned_document(db, user, doc_id)
    p = ResearchProject(owner_id=user.id, title=body.title, topic=body.topic, source_document_ids=body.source_document_ids, sections={})
    db.add(p)
    db.commit()
    return research_out(p)


@router.get("/{project_id}")
def get_project(project_id: str, user: CurrentUser, db: DB):
    return research_out(_project(db, user, project_id))


@router.patch("/{project_id}")
def update_project(project_id: str, body: ResearchUpdate, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return research_out(p)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, user: CurrentUser, db: DB):
    db.delete(_project(db, user, project_id))
    db.commit()


# ─── Discovery & references ───────────────────────────────────────────────────
@router.post("/{project_id}/discover")
def discover(project_id: str, body: DiscoverIn, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    local = []
    for doc_id in p.source_document_ids or []:
        d = db.get(Document, doc_id)
        if d and d.owner_id == user.id:
            local.append((d.id, d.title, d.author))
    results, warnings = research.discover(body.query or p.topic, body.limit, local)
    existing = {(r.doi or "").lower() for r in p.references if r.doi} | {research._norm_title(r.title) for r in p.references}
    for r in results:
        r["already_added"] = (r.get("doi") or "").lower() in existing or research._norm_title(r["title"]) in existing
    return {"query": body.query or p.topic, "results": results, "warnings": warnings}


@router.post("/{project_id}/references", status_code=201)
def add_references(project_id: str, items: list[dict], user: CurrentUser, db: DB):
    """Add discovered results (as returned by /discover) or manual entries."""
    p = _project(db, user, project_id)
    existing = {research._norm_title(r.title) for r in p.references}
    added = []
    for raw in items[:50]:
        data = ReferenceCreate.model_validate(raw).model_dump()
        if research._norm_title(data["title"]) in existing:
            continue
        ref = Reference(
            project_id=p.id, **data,
            citations=int(raw.get("citations") or 0), relevance=float(raw.get("relevance") or 0.5),
            provider=str(raw.get("provider") or "Manual")[:40], publication_type=str(raw.get("publication_type") or "Article")[:40],
            open_access=bool(raw.get("open_access")), summary=raw.get("summary"), included=True,
        )
        p.references.append(ref)
        existing.add(research._norm_title(ref.title))
        added.append(ref)
    if p.status == "exploring" and p.references:
        p.status = "drafting"
    db.commit()
    return {"added": [reference_out(r) for r in added], "project": research_out(p)}


@router.patch("/{project_id}/references/{reference_id}")
def update_reference(project_id: str, reference_id: str, body: ReferenceUpdate, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    ref = next((r for r in p.references if r.id == reference_id), None)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ref, k, v)
    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    return reference_out(ref)


@router.delete("/{project_id}/references/{reference_id}", status_code=204)
def delete_reference(project_id: str, reference_id: str, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    ref = next((r for r in p.references if r.id == reference_id), None)
    if not ref:
        raise HTTPException(status_code=404, detail="Reference not found")
    p.references.remove(ref)
    db.commit()


@router.get("/{project_id}/citations")
def citations(project_id: str, user: CurrentUser, db: DB, style: str | None = None):
    p = _project(db, user, project_id)
    style = (style or p.citation_style).upper()
    included = [r for r in p.references if r.included]
    return {
        "style": style,
        "entries": [
            {"number": i, "reference_id": r.id, "citation": research.format_citation(r, style, i), "in_text": research.in_text(r, style, i)}
            for i, r in enumerate(included, 1)
        ],
        "warnings": research.citation_warnings(p),
    }


# ─── Outline & drafting ───────────────────────────────────────────────────────
@router.post("/{project_id}/outline")
def generate_outline(project_id: str, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    titles = " ".join(r.title + " " + (r.abstract or "") for r in p.references if r.included)
    themes = nlp.key_phrases(titles + " " + p.topic, 6) if titles else nlp.key_phrases(p.topic, 4)
    outline = [
        {"key": "abstract", "title": "Abstract", "points": ["Problem and motivation", "Approach", "Key findings", "Implications"]},
        {"key": "introduction", "title": "Introduction", "points": [f"Context: {p.topic}", "Why it matters", "Research question", "Paper structure"]},
        {"key": "literature_review", "title": "Literature Review", "points": [f"Theme: {t}" for t in themes[:4]] or ["Prior work"]},
        {"key": "methodology", "title": "Methodology", "points": ["Search strategy and databases", "Inclusion criteria", "Analysis approach", "Limitations"]},
        {"key": "results", "title": "Results & Discussion", "points": ["Main findings", "Areas of agreement and conflict", "Interpretation"]},
        {"key": "conclusion", "title": "Conclusion", "points": ["Summary of contribution", "Future work"]},
    ]
    p.outline = outline
    db.commit()
    return {"outline": outline}


@router.post("/{project_id}/sections/{key}")
def draft_section(project_id: str, key: str, body: SectionAction, user: CurrentUser, db: DB):
    if key not in SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown section")
    p = _project(db, user, project_id)
    content = research.draft_section(p, key, body.action, _source_text(db, user, p))
    return _save_section(db, p, key, content, body.action)


@router.put("/{project_id}/sections/{key}")
def edit_section(project_id: str, key: str, body: SectionEdit, user: CurrentUser, db: DB):
    if key not in SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown section")
    p = _project(db, user, project_id)
    return _save_section(db, p, key, body.content, "edit")


def _save_section(db, p: ResearchProject, key: str, content: str, action: str) -> dict:
    sections = dict(p.sections or {})
    current = dict(sections.get(key) or {"content": "", "status": "empty", "versions": []})
    versions = list(current.get("versions") or [])
    if current.get("content", "").strip() and current["content"] != content:
        # Consecutive manual edits collapse into one version so autosave doesn't flood history.
        if not (action == "edit" and versions and versions[-1].get("action") == "edit"):
            versions.append({"content": current["content"], "action": current.get("last_action", "edit"),
                             "created_at": datetime.now(timezone.utc).isoformat()})
    current.update(content=content, status="draft" if content.strip() else "empty", versions=versions[-MAX_VERSIONS:], last_action=action)
    sections[key] = current
    p.sections = sections
    if p.status == "exploring" and content.strip():
        p.status = "drafting"
    db.commit()
    return {"key": key, "section": current, "project": research_out(p, full=False)}


@router.post("/{project_id}/sections/{key}/restore/{version}")
def restore_version(project_id: str, key: str, version: int, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    versions = ((p.sections or {}).get(key) or {}).get("versions") or []
    if not 0 <= version < len(versions):
        raise HTTPException(status_code=404, detail="Version not found")
    return _save_section(db, p, key, versions[version]["content"], "restore")


@router.get("/{project_id}/review")
def review(project_id: str, user: CurrentUser, db: DB):
    """Plagiarism-awareness & citation review. Flags passages to check — never claims originality."""
    p = _project(db, user, project_id)
    sources = [(r.title, (r.abstract or "")) for r in p.references]
    src_text = _source_text(db, user, p)
    if src_text:
        sources.append(("Uploaded sources", src_text))
    report = []
    for key in SECTION_KEYS:
        content = ((p.sections or {}).get(key) or {}).get("content", "")
        if not content.strip():
            continue
        report.append({
            "section": key,
            "title": research.SECTION_TITLES[key],
            "words": len(content.split()),
            "similarity": nlp.similarity_flags(content, sources),
            "needs_citation": nlp.uncited_claims(content),
        })
    return {
        "sections": report,
        "citation_warnings": research.citation_warnings(p),
        "disclaimer": "This review highlights passages worth checking. It cannot guarantee that a text is free of plagiarism.",
    }


@router.post("/{project_id}/export")
def export(project_id: str, body: ExportIn, user: CurrentUser, db: DB):
    p = _project(db, user, project_id)
    name = storage.safe_name(p.title)
    if body.format == "md":
        return Response(research.export_markdown(p, user.name), media_type="text/markdown",
                        headers={"Content-Disposition": f'attachment; filename="{name}.md"'})
    if body.format == "pdf":
        return Response(research.export_pdf(p, user.name), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return Response(research.export_docx(p, user.name),
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}.docx"'})
