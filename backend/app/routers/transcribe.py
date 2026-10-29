"""Speech-to-text: turn a recording into a transcript (and optionally a library document), or dictate a short clip."""
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..database import SessionLocal
from ..deps import DB, CurrentUser
from ..services import extraction, ingest, jobs, storage, transcribe

log = logging.getLogger("readvibe.transcribe")
router = APIRouter(prefix="/transcribe", tags=["transcribe"])

DICTATION_MAX_MB = 6


def _flag(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "on")


def _require_setup() -> None:
    if not transcribe.configured():
        raise HTTPException(status_code=503, detail="Transcription isn’t set up on this server yet. It needs a GPU server running the "
                                                    "Nemotron Transcribe model (set READVIBE_TRANSCRIBE_BASE_URL).")


def _check_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in transcribe.SUPPORTED:
        raise HTTPException(status_code=415, detail=f"Unsupported audio type. Supported: {', '.join(transcribe.SUPPORTED)}")
    return ext


@router.get("/status")
def transcribe_status(_: CurrentUser):
    return transcribe.status()


@router.post("", status_code=202)
async def start_transcription(
    user: CurrentUser, db: DB, file: UploadFile = File(...),
    style: str = Form("readable"), translate_to: str = Form(""), context: str = Form(""),
    timestamps: str = Form("false"), save: str = Form("true"), title: str = Form(""),
):
    """Queue a transcription job. The job's result holds the transcript and, with `save`, the new document's id."""
    _require_setup()
    filename = file.filename or "recording.wav"
    _check_type(filename)
    limit = get_settings().transcribe_max_mb * 1024 * 1024
    try:
        rel, _size = await storage.save_stream(user.id, "transcribe", filename, file, limit)
    except storage.TooLarge as exc:
        raise HTTPException(status_code=413, detail=f"Recordings must be {get_settings().transcribe_max_mb} MB or smaller") from exc
    name = title.strip()[:200] or filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip() or "Recording"
    job = jobs.create_job(db, user.id, "transcribe", f"Transcribing {filename}")
    owner_id, keep, want_words = user.id, _flag(save), _flag(timestamps)

    def work(ctx: jobs.JobContext) -> dict:
        path = storage.resolve(rel)
        try:
            ctx.update("Sending the recording to the speech model", 10)
            result = transcribe.transcribe(path, filename, style=style, translate_to=translate_to or None, context=context or None, timestamps=want_words)
            ctx.update("Transcribed", 85)
            out = {"text": result["text"], "turns": result["turns"], "words": result["words"], "style": result["style"], "title": name}
            if keep:
                with SessionLocal() as session:
                    try:
                        doc = ingest.create_from_text(session, owner_id, f"Transcript: {name}", "Transcription", result["text"], "DOCUMENT", ["transcript"])
                    except extraction.ExtractionError as exc:
                        raise transcribe.TranscribeError(str(exc), 422) from exc
                    out["document_id"], out["title"] = doc.id, doc.title
            return out
        finally:
            storage.delete(rel)  # the recording is not kept; only the transcript is

    jobs.submit(job.id, work)
    return {"job_id": job.id}


@router.post("/dictate")
async def dictate(user: CurrentUser, file: UploadFile = File(...)):
    """A short clip (a few seconds to a minute, up to 6 MB) turned into text straight away — for the voice button in chat."""
    _require_setup()
    filename = file.filename or "clip.webm"
    _check_type(filename)
    try:
        rel, _size = await storage.save_stream(user.id, "transcribe", filename, file, DICTATION_MAX_MB * 1024 * 1024)
    except storage.TooLarge as exc:
        raise HTTPException(status_code=413, detail=f"Voice clips must be {DICTATION_MAX_MB} MB or smaller") from exc
    try:
        result = await run_in_threadpool(transcribe.transcribe, storage.resolve(rel), filename, style="readable")
    except transcribe.TranscribeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        storage.delete(rel)
    return {"text": result["text"]}
