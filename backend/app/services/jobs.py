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


class JobContext:
    """Handle passed to job functions for progress reporting."""

    def __init__(self, job_id: str):
        self.job_id = job_id

    def update(self, stage: str, progress: float, **fields) -> None:
        with SessionLocal() as db:
            job = db.get(Job, self.job_id)
            if job:
                job.stage = stage
                job.progress = max(job.progress, min(100.0, progress))
                job.status = "processing"
                for k, v in fields.items():
                    setattr(job, k, v)
                db.commit()


def create_job(db, owner_id: str, kind: str, title: str, ref_id: str | None = None) -> Job:
    job = Job(owner_id=owner_id, kind=kind, title=title, ref_id=ref_id, status="queued", stage="Queued", progress=0)
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
                if job:
                    job.status, job.stage, job.progress = "completed", "Completed", 100.0
                    job.result = result or {}
                    db.commit()
        except Exception as exc:  # noqa: BLE001
            log.error("job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
            with SessionLocal() as db:
                job = db.get(Job, job_id)
                if job:
                    job.status, job.stage, job.error = "failed", "Failed", str(exc)[:500]
                    db.commit()

    if _inline:
        runner()
    else:
        _executor.submit(runner)
