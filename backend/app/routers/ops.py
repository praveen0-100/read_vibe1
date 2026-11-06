"""Operations: Prometheus metrics and a readiness probe (separate from /api/health, which stays cheap and always answers)."""
import hmac

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select, text

from ..config import get_settings
from ..database import SessionLocal
from ..models import Job
from ..services import metrics

router = APIRouter(tags=["ops"])


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def prometheus(request: Request):
    token = get_settings().metrics_token
    if not token:
        raise HTTPException(status_code=404, detail="Not found")  # disabled unless explicitly configured
    given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, token):
        raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"})
    with SessionLocal() as db:
        jobs = {status: n for status, n in db.execute(select(Job.status, func.count()).group_by(Job.status)).all()}
    return PlainTextResponse(metrics.render(labelled={"jobs": jobs}), media_type="text/plain; version=0.0.4")


@router.get("/ready")
def ready():
    """Readiness: can this instance serve traffic (database reachable)? Orchestrators gate rollouts on it."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ready"}
