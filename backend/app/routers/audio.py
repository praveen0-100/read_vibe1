"""Audio Studio: multi-tone audiobooks and the collaborative recording studio."""
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import select

from ..database import SessionLocal
from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Audiobook, CollabProject, Document, Recording
from ..schemas import AudiobookCreate, AudiobookUpdate, CollabCreate, CollabUpdate, PreviewIn
from ..serializers import audiobook_out, collab_out, recording_out
from ..services import jobs, narration, storage

router = APIRouter(prefix="/audio", tags=["audio"])

MAX_RECORDING_MB = 60


@router.get("/tones")
def tones():
    return [{"id": k, **v, "preview": narration.preview_text(k)} for k, v in narration.TONES.items()]


@router.post("/preview")
def preview(body: PreviewIn):
    cfg = narration.TONES[body.tone]
    text = body.text or narration.preview_text(body.tone)
    return {"tone": body.tone, "rate": cfg["rate"], "pitch": cfg["pitch"], "segments": [{"text": text, "pause_ms": 0}]}


@router.get("/audiobooks")
def list_audiobooks(user: CurrentUser, db: DB):
    books = db.scalars(select(Audiobook).where(Audiobook.owner_id == user.id).order_by(Audiobook.updated_at.desc())).all()
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.owner_id == user.id))}
    return [audiobook_out(a, doc=docs.get(a.document_id)) for a in books]


@router.post("/audiobooks", status_code=status.HTTP_202_ACCEPTED)
def create_audiobook(body: AudiobookCreate, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id)
    if doc.status != "ready":
        raise HTTPException(status_code=409, detail="The document is still processing")
    cfg = narration.TONES[body.tone]
    book = Audiobook(
        owner_id=user.id, document_id=doc.id, title=doc.title, tone=body.tone, voice=body.voice,
        status="processing", rate=body.rate * cfg["rate"], pitch=cfg["pitch"], script=[],
    )
    db.add(book)
    db.commit()
    job = jobs.create_job(db, user.id, "audiobook", f"{body.tone} narration of “{doc.title}”", ref_id=book.id)
    selected = body.chapter_indexes

    def run(ctx: jobs.JobContext) -> dict:
        ctx.update("Extracting text", 10)
        with SessionLocal() as s:
            d = s.get(Document, doc.id)
            b = s.get(Audiobook, book.id)
            chapters = [(c.position, c.title, c.content) for c in d.chapters if selected is None or c.position in selected]
            ctx.update("Splitting chapters", 30)
            script, chapter_scripts = [], []
            total = 0
            for i, ch in enumerate(chapters):
                part, secs = narration.build_script([ch], body.tone)
                chapter_scripts.extend(part)
                total += secs
                ctx.update(f"Generating {body.tone.lower()} narration · chapter {i + 1} of {len(chapters)}", 30 + 60 * (i + 1) / max(1, len(chapters)))
            script = chapter_scripts
            ctx.update("Finalizing", 95)
            b.script, b.duration_seconds, b.status = script, total, "ready"
            s.commit()
            return {"audiobook_id": b.id, "chapters": len(script), "duration_seconds": total}

    jobs.submit(job.id, run)
    return {"audiobook": audiobook_out(book), "job_id": job.id}


@router.get("/audiobooks/{book_id}")
def get_audiobook(book_id: str, user: CurrentUser, db: DB):
    book = get_owned(db, Audiobook, user, book_id, "Audiobook")
    return audiobook_out(book, with_script=True, doc=db.get(Document, book.document_id))


@router.patch("/audiobooks/{book_id}")
def update_audiobook(book_id: str, body: AudiobookUpdate, user: CurrentUser, db: DB):
    book = get_owned(db, Audiobook, user, book_id, "Audiobook")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(book, k, v)
    db.commit()
    return audiobook_out(book)


@router.delete("/audiobooks/{book_id}", status_code=204)
def delete_audiobook(book_id: str, user: CurrentUser, db: DB):
    db.delete(get_owned(db, Audiobook, user, book_id, "Audiobook"))
    db.commit()


@router.get("/audiobooks/{book_id}/script.txt")
def download_script(book_id: str, user: CurrentUser, db: DB):
    book = get_owned(db, Audiobook, user, book_id, "Audiobook")
    lines = [f"{book.title} — {book.tone} narration", ""]
    for ch in book.script or []:
        lines += [f"## {ch['title']}", ""] + [s["text"] for s in ch["segments"]] + [""]
    return Response("\n".join(lines), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{storage.safe_name(book.title)}-script.txt"'})


# ─── Collaborative audiobook studio ───────────────────────────────────────────
def _recordings(db, project_id: str) -> list[Recording]:
    return list(db.scalars(select(Recording).where(Recording.project_id == project_id).order_by(Recording.created_at)))


@router.get("/collab")
def list_collab(user: CurrentUser, db: DB):
    projects = db.scalars(select(CollabProject).where(CollabProject.owner_id == user.id).order_by(CollabProject.updated_at.desc())).all()
    return [collab_out(p, _recordings(db, p.id)) for p in projects]


@router.post("/collab", status_code=201)
def create_collab(body: CollabCreate, user: CurrentUser, db: DB):
    assignments = []
    if body.document_id:
        doc = get_owned_document(db, user, body.document_id)
        assignments = [
            {"id": uuid.uuid4().hex[:12], "chapter_index": c.position, "title": c.title, "collaborator_id": None, "status": "unassigned", "recording_id": None}
            for c in doc.chapters
        ]
    me = {"id": uuid.uuid4().hex[:12], "name": f"{user.name} (you)", "email": user.email, "role": "Producer"}
    p = CollabProject(owner_id=user.id, title=body.title, document_id=body.document_id, collaborators=[me], assignments=assignments)
    db.add(p)
    db.commit()
    return collab_out(p)


@router.patch("/collab/{project_id}")
def update_collab(project_id: str, body: CollabUpdate, user: CurrentUser, db: DB):
    p = get_owned(db, CollabProject, user, project_id, "Project")
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "collaborators" and v is not None:
            v = [{**c, "id": c.get("id") or uuid.uuid4().hex[:12]} for c in v]
        if k == "assignments" and v is not None:
            v = [{**a, "id": a.get("id") or uuid.uuid4().hex[:12]} for a in v]
        setattr(p, k, v)
    db.commit()
    return collab_out(p, _recordings(db, p.id))


@router.delete("/collab/{project_id}", status_code=204)
def delete_collab(project_id: str, user: CurrentUser, db: DB):
    p = get_owned(db, CollabProject, user, project_id, "Project")
    for r in _recordings(db, p.id):
        storage.delete(r.file_path)
    db.delete(p)
    db.commit()


@router.post("/collab/{project_id}/recordings", status_code=201)
async def upload_recording(
    project_id: str, user: CurrentUser, db: DB,
    assignment_id: str = Form(...), duration_seconds: float = Form(0), file: UploadFile = File(...),
):
    p = get_owned(db, CollabProject, user, project_id, "Project")
    assignment = next((a for a in p.assignments or [] if a["id"] == assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty recording")
    if len(data) > MAX_RECORDING_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Recordings must be under {MAX_RECORDING_MB} MB")
    mime = (file.content_type or "audio/webm").split(";")[0]
    ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav"}.get(mime, "webm")
    rec_id = uuid.uuid4().hex
    path = storage.save(user.id, f"recordings/{p.id}", f"{rec_id}.{ext}", data)
    previous = assignment.get("recording_id")
    rec = Recording(id=rec_id, owner_id=user.id, project_id=p.id, assignment_id=assignment_id, file_path=path, mime_type=mime, duration_seconds=duration_seconds)
    db.add(rec)
    p.assignments = [{**a, "recording_id": rec_id, "status": "recorded"} if a["id"] == assignment_id else a for a in p.assignments]
    if previous:
        old = db.get(Recording, previous)
        if old:
            storage.delete(old.file_path)
            db.delete(old)
    db.commit()
    return {"recording": recording_out(rec), "project": collab_out(p, _recordings(db, p.id))}


@router.get("/collab/{project_id}/recordings/{recording_id}")
def stream_recording(project_id: str, recording_id: str, user: CurrentUser, db: DB):
    get_owned(db, CollabProject, user, project_id, "Project")
    rec = get_owned(db, Recording, user, recording_id, "Recording")
    path = storage.resolve(rec.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Recording file missing")
    return FileResponse(path, media_type=rec.mime_type)


@router.delete("/collab/{project_id}/recordings/{recording_id}", status_code=204)
def delete_recording(project_id: str, recording_id: str, user: CurrentUser, db: DB):
    p = get_owned(db, CollabProject, user, project_id, "Project")
    rec = get_owned(db, Recording, user, recording_id, "Recording")
    storage.delete(rec.file_path)
    p.assignments = [{**a, "recording_id": None, "status": "assigned" if a.get("collaborator_id") else "unassigned"} if a.get("recording_id") == rec.id else a for a in p.assignments]
    db.delete(rec)
    db.commit()
