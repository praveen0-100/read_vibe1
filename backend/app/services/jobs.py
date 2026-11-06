"""In-process background job runner.

Jobs are persisted in the `jobs` table so the UI can poll progress and show notifications.
The executor is deliberately small and swappable — replace `submit` with a Celery/RQ/RabbitMQ
producer to scale out horizontally; job functions only need a job id.
"""
from __future__ import annotations

import logging
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from ..config import get_settings
from ..database import SessionLocal
from ..models import Job

log = logging.getLogger("readvibe.jobs")

_executor = ThreadPoolExecutor(max_workers=get_settings().worker_threads, thread_name_prefix="readvibe-job")
_inline = False  # tests flip this to run jobs synchronously


def run_inline(enabled: bool = True) -> None:
    global _inline
    _inline = enabled


class JobCancelled(Exception):
    """Raised inside a job when its owner cancelled it; the runner leaves the `cancelled` state untouched."""


class JobContext:
    """Handle passed to job functions for progress reporting."""

    def __init__(self, job_id: str):
        self.job_id = job_id

    def update(self, stage: str, progress: float, **fields) -> None:
        with SessionLocal() as db:
            job = db.get(Job, self.job_id)
            if job and job.status == "cancelled":
                raise JobCancelled(self.job_id)
            if job:
                job.stage = stage
                job.progress = max(job.progress, min(100.0, progress))
                job.status = "processing"
                for k, v in fields.items():
                    setattr(job, k, v)
                db.commit()


# kind -> builder(config) returning the job function. A kind that registers one can be retried and survives a restart.
_RUNNERS: dict[str, Callable[[dict], Callable[[JobContext], dict | None]]] = {}


def register(kind: str, builder: Callable[[dict], Callable[[JobContext], dict | None]]) -> None:
    _RUNNERS[kind] = builder


def runner_for(job: Job) -> Callable[[JobContext], dict | None] | None:
    builder = _RUNNERS.get(job.kind)
    return builder(job.config) if builder and job.config else None


def create_job(db, owner_id: str, kind: str, title: str, ref_id: str | None = None, config: dict | None = None) -> Job:
    job = Job(owner_id=owner_id, kind=kind, title=title, ref_id=ref_id, status="queued", stage="Queued", progress=0, config=config)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def submit(job_id: str, fn: Callable[[JobContext], dict | None]) -> None:
    def runner():
        ctx = JobContext(job_id)
        try:
            result = fn(ctx)
            with SessionLocal() as db:
                job = db.get(Job, job_id)
                if job and job.status != "cancelled":  # a cancelled job must never flip to a false "ready"
                    job.status, job.stage, job.progress = "completed", "Completed", 100.0
                    job.result = result or {}
                    db.commit()
        except JobCancelled:
            log.info("job %s cancelled", job_id)
        except Exception as exc:  # noqa: BLE001
            log.error("job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
            with SessionLocal() as db:
                job = db.get(Job, job_id)
                if job and job.status != "cancelled":
                    job.status, job.stage, job.error = "failed", "Failed", str(exc)[:500]
                    db.commit()

    if _inline:
        runner()
    else:
        _executor.submit(runner)


def retry(job_id: str) -> bool:
    """Reset a failed/cancelled job and run it again. False when its kind cannot be re-run."""
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None or job.status not in ("failed", "cancelled"):
            return False
        fn = runner_for(job)
        if fn is None:
            return False
        job.status, job.stage, job.progress, job.error, job.seen = "queued", "Queued", 0.0, None, False
        job.attempts = (job.attempts or 1) + 1
        db.commit()
    submit(job_id, fn)
    return True


def recover() -> dict:
    """At startup: jobs left queued/processing by a previous process were killed with it. Re-run those that can be,
    and fail the rest with an honest message instead of leaving them spinning forever."""
    requeued = failed = 0
    with SessionLocal() as db:
        stuck = [j.id for j in db.query(Job).filter(Job.status.in_(["queued", "processing"])).all()]
    for job_id in stuck:
        with SessionLocal() as db:
            job = db.get(Job, job_id)
            fn = runner_for(job) if job else None
            if job is not None and fn is not None:
                job.status, job.stage, job.progress = "queued", "Queued (resumed after restart)", 0.0
                job.attempts = (job.attempts or 1) + 1
                db.commit()
                requeued += 1
            elif job is not None:
                job.status, job.stage, job.error = "failed", "Failed", "Interrupted by a server restart. Please start it again."
                db.commit()
                failed += 1
                fn = None
        if fn is not None:
            submit(job_id, fn)
    return {"requeued": requeued, "failed": failed}
