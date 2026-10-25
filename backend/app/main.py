"""ReadVibe API application factory."""
from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import get_settings
from .database import SessionLocal, engine, init_db
from .routers import activity, ai, audio, auth, catalog, documents, notes, research, tts
from .services import llm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("readvibe")
settings = get_settings()


def _seed_in_background() -> None:
    from .seed import seed_demo

    try:
        with SessionLocal() as db:
            seed_demo(db)
    except Exception:  # noqa: BLE001
        log.exception("Demo seeding failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.environment == "production" and settings.jwt_secret.startswith("change-me"):
        raise RuntimeError("Set READVIBE_JWT_SECRET to a long random value before running in production")
    init_db()
    if settings.seed_demo_data:
        # Seeding hashes passwords and builds documents; do it off the startup path so the port opens (and a
        # sleeping free-tier instance answers its first request) sooner. /auth/demo seeds on demand as a fallback.
        threading.Thread(target=_seed_in_background, daemon=True, name="seed-demo").start()
    log.info("ReadVibe API %s ready · AI provider: %s", __version__, llm.provider_name())
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="AI-powered immersive reading, audiobook and research platform.",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID"],
)


# ─── Rate limiting (sliding window, per client + bucket) ──────────────────────
class RateLimiter:
    def __init__(self):
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float = 60.0) -> tuple[bool, int]:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False, int(window - (now - q[0])) + 1
            q.append(now)
            return True, 0


limiter = RateLimiter()


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    path = request.url.path
    if path.startswith("/api/") and request.method != "OPTIONS":
        client = request.headers.get("authorization", "")[-24:] or (request.client.host if request.client else "anon")
        is_ai = path.startswith("/api/ai/") or "/discover" in path or "/sections/" in path
        bucket, limit = ("ai", settings.ai_rate_limit_per_minute) if is_ai else ("api", settings.rate_limit_per_minute)
        ok, retry = limiter.allow(f"{bucket}:{client}", limit)
        if not ok:
            return JSONResponse(
                {"detail": "Too many requests — please slow down.", "request_id": request_id},
                status_code=429, headers={"Retry-After": str(retry), "X-Request-ID": request_id},
            )
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if path.startswith("/api/") and elapsed > 1500:
        log.info("slow request %s %s %.0fms id=%s", request.method, path, elapsed, request_id)
    return response


# ─── Error handling: consistent JSON errors ───────────────────────────────────
@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    return JSONResponse({"detail": f"{field}: {first.get('msg', 'invalid value')}", "errors": [
        {"loc": e.get("loc"), "msg": e.get("msg")} for e in errors
    ]}, status_code=422)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["system"])
def health():
    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "readvibe-api",
        "version": __version__,
        "database": db_ok,
        "ai_provider": llm.provider_name(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


for module in (auth, catalog, documents, notes, ai, audio, research, activity, tts):
    app.include_router(module.router, prefix="/api")
