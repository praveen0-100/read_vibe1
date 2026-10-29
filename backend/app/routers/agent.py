"""Vibe — the reading agent: chat, daily briefing, what it knows about you, and your controls over it."""
from fastapi import APIRouter, HTTPException, Query

from ..deps import DB, CurrentUser, get_owned_document
from ..schemas import AgentChatIn, AgentCheckinIn, AgentEventIn, AgentSettingsIn
from ..services.agent import briefing, empathy, gateway, memory, orchestrator, profile

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/status")
def agent_status(user: CurrentUser):
    s = gateway.status()
    return {**s, "settings": profile.settings_for(user)}


@router.post("/chat")
def agent_chat(body: AgentChatIn, user: CurrentUser, db: DB):
    doc = get_owned_document(db, user, body.document_id) if body.document_id else None
    return orchestrator.respond(
        db, user, message=body.message.strip(), document=doc, chapter_index=body.chapter_index, selection=body.selection,
        history=[t.model_dump() for t in body.history], tz_offset=body.tz_offset, session_minutes=body.session_minutes,
    )


@router.get("/briefing")
def agent_briefing(user: CurrentUser, db: DB, tz_offset: int = Query(0, ge=-900, le=900)):
    return briefing.build(db, user, tz_offset)


@router.post("/checkin")
def agent_checkin(body: AgentCheckinIn, user: CurrentUser, db: DB):
    if profile.settings_for(user)["personalize"]:
        memory.record_event(db, user.id, "checkin", {"mood": body.mood})
    return {"mood": body.mood, "message": empathy.CHECKIN_REPLIES[body.mood], "remembered": bool(profile.settings_for(user)["personalize"])}


@router.post("/events", status_code=204)
def agent_event(body: AgentEventIn, user: CurrentUser, db: DB):
    """Signals the app reports on the reader's behalf: a finished quiz, thumbs up/down on an answer."""
    if not profile.settings_for(user)["personalize"]:
        return
    if body.document_id:
        get_owned_document(db, user, body.document_id)
    payload = body.payload if isinstance(body.payload, dict) else {}
    if body.kind == "quiz":
        total, score = payload.get("total"), payload.get("score")
        if not (isinstance(total, int) and isinstance(score, (int, float)) and 0 < total <= 200 and 0 <= score <= total):
            raise HTTPException(status_code=422, detail="quiz events need integer total and a score between 0 and total")
        payload = {"score": score, "total": total, "chapter_index": payload.get("chapter_index")}
    elif body.kind == "feedback":
        payload = {"helpful": bool(payload.get("helpful"))}
    else:
        raise HTTPException(status_code=422, detail="use /agent/checkin for mood check-ins")
    memory.record_event(db, user.id, body.kind, payload, body.document_id)


@router.get("/profile")
def agent_profile(user: CurrentUser, db: DB, tz_offset: int = Query(0, ge=-900, le=900)):
    """Everything the agent uses to personalise: shown to the reader in Settings."""
    return profile.build(db, user, tz_offset)


@router.put("/settings")
def agent_settings(body: AgentSettingsIn, user: CurrentUser, db: DB):
    prefs = dict(user.preferences or {})
    prefs["agent"] = {**profile.settings_for(user), **body.model_dump(exclude_none=True)}
    user.preferences = prefs
    db.commit()
    return prefs["agent"]


@router.delete("/memories/{memory_id}", status_code=204)
def delete_memory(memory_id: str, user: CurrentUser, db: DB):
    if not memory.forget(db, user.id, memory_id):
        raise HTTPException(status_code=404, detail="Memory not found")


@router.delete("/memories")
def clear_everything(user: CurrentUser, db: DB):
    """Forget everything the agent has learned: memories, quiz results, mood check-ins and tone labels."""
    return memory.forget_everything(db, user.id)
