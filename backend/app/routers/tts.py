"""Natural read-aloud voices (neural TTS with word timings)."""
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from ..deps import CurrentUser
from ..schemas import TTSIn
from ..services import tts

router = APIRouter(prefix="/tts", tags=["tts"])


@router.get("/status")
def status(_: CurrentUser):
    return {"available": tts.available(), "providers": tts.providers(), "default_voice": tts.DEFAULT_VOICE}


@router.get("/voices")
async def voices(_: CurrentUser):
    return await run_in_threadpool(tts.voices)


@router.post("/synthesize")
async def synthesize(body: TTSIn, _: CurrentUser):
    if not tts.available():
        raise HTTPException(status_code=503, detail="Natural voices aren’t enabled on this server")
    try:
        return await run_in_threadpool(tts.synthesize, body.text, body.voice)
    except tts.TTSError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
