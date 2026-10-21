"""Local file storage. Swap for S3/GCS by re-implementing these three functions."""
from __future__ import annotations

import re
from pathlib import Path

from ..config import get_settings


def _root() -> Path:
    return get_settings().storage_dir


def safe_name(filename: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._") or "file"
    return name[-120:]


def save(owner_id: str, folder: str, filename: str, data: bytes) -> str:
    directory = _root() / owner_id / folder
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / safe_name(filename)
    path.write_bytes(data)
    return str(path.relative_to(_root()).as_posix())


class TooLarge(Exception):
    pass


CHUNK_BYTES = 4 * 1024 * 1024


async def save_stream(owner_id: str, folder: str, filename: str, upload, max_bytes: int) -> tuple[str, int]:
    """Stream an UploadFile to disk in chunks (never holds the whole file in memory).

    Raises TooLarge (and removes the partial file) once `max_bytes` is exceeded.
    Returns (relative path, size in bytes).
    """
    directory = _root() / owner_id / folder
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / safe_name(filename)
    partial = path.with_name(path.name + ".part")
    size = 0
    try:
        with partial.open("wb") as fh:
            while chunk := await upload.read(CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge
                fh.write(chunk)
        await _retrying(lambda: partial.replace(path))
    except BaseException:
        try:
            await _retrying(lambda: partial.unlink(missing_ok=True))
        except OSError:
            pass  # never mask the original error; a stale .part file is harmless
        raise
    return str(path.relative_to(_root()).as_posix()), size


async def _retrying(fn, attempts: int = 12):
    """Windows antivirus/indexers briefly lock freshly written large files; retry with backoff."""
    import asyncio

    for i in range(attempts):
        try:
            return fn()
        except PermissionError:
            if i == attempts - 1:
                raise
            await asyncio.sleep(min(2.0, 0.1 * 2**i))


def resolve(relative: str) -> Path:
    path = (_root() / relative).resolve()
    if _root().resolve() not in path.parents:
        raise ValueError("Invalid storage path")
    return path


def delete(relative: str | None) -> None:
    if not relative:
        return
    try:
        resolve(relative).unlink(missing_ok=True)
    except (ValueError, OSError):
        pass
