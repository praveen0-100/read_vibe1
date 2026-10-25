"""Import free, openly-licensed / public-domain books from Project Gutenberg and the Internet Archive.

The client sends only a source and an identifier; the server builds the download URL itself, so it can
never be pointed at an arbitrary host.
"""
import re
import time
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..deps import DB, CurrentUser
from ..serializers import document_out
from ..services import extraction, ingest

router = APIRouter(prefix="/catalog", tags=["catalog"])

MAX_BYTES = 25 * 1024 * 1024
ARCHIVE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
START_MARK = re.compile(r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n", re.I)
END_MARK = re.compile(r"\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK", re.I)


class CatalogImport(BaseModel):
    source: Literal["gutenberg", "archive"]
    id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="Unknown", max_length=200)
    tags: list[str] = []


def _fetch(urls: list[str]) -> str:
    last = "No readable text was found for this title"
    with httpx.Client(follow_redirects=True, timeout=45, headers={"User-Agent": "ReadVibe/1.0 (open-book import)"}) as client:
        for url in urls:
            try:
                with client.stream("GET", url) as res:
                    if res.status_code != 200:
                        last = f"The source returned {res.status_code}"
                        continue
                    if res.url.host not in ("www.gutenberg.org", "gutenberg.org", "archive.org") and not res.url.host.endswith(".archive.org"):
                        last = "Unexpected redirect"
                        continue
                    data = bytearray()
                    for chunk in res.iter_bytes():
                        data += chunk
                        if len(data) > MAX_BYTES:
                            raise HTTPException(status_code=413, detail="This book is too large to import (25 MB limit)")
                    return data.decode("utf-8", errors="replace")
            except httpx.HTTPError:
                last = "Couldn't reach the source — try again shortly"
    raise HTTPException(status_code=502, detail=last)


def _strip_gutenberg(text: str) -> str:
    start = START_MARK.search(text)
    if start:
        text = text[start.end():]
    end = END_MARK.search(text)
    if end:
        text = text[: end.start()]
    return text.strip()


@router.post("/import", status_code=201)
def import_book(body: CatalogImport, user: CurrentUser, db: DB):
    if body.source == "gutenberg":
        if not body.id.isdigit():
            raise HTTPException(status_code=400, detail="Invalid Project Gutenberg id")
        n = int(body.id)
        text = _strip_gutenberg(_fetch([
            f"https://www.gutenberg.org/cache/epub/{n}/pg{n}.txt",
            f"https://www.gutenberg.org/ebooks/{n}.txt.utf-8",
        ]))
        tags = body.tags or ["Project Gutenberg"]
    else:
        if not ARCHIVE_ID.match(body.id):
            raise HTTPException(status_code=400, detail="Invalid Internet Archive identifier")
        text = _fetch([f"https://archive.org/download/{body.id}/{body.id}_djvu.txt"]).strip()
        tags = body.tags or ["Internet Archive"]
    if len(text) < 200:
        raise HTTPException(status_code=422, detail="This title has no readable text available")
    try:
        doc = ingest.create_from_text(db, user.id, body.title, body.author, text, "BOOK", tags[:6])
    except extraction.ExtractionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return document_out(doc)


# ─── Live catalogue feeds (proxied: Gutendex rejects browser requests that carry an Origin header) ───
_cache: dict[str, tuple[float, dict]] = {}
CACHE_SECONDS = 15 * 60
UA = {"User-Agent": "ReadVibe/1.0 (open-book catalogue)"}


def _get_json(url: str, params: dict | None = None) -> dict:
    key = url + repr(sorted((params or {}).items()))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    data, exc = None, None
    for attempt in range(3):  # the free upstreams occasionally drop a request
        try:
            res = httpx.get(url, params=params, headers=UA, timeout=25, follow_redirects=True)
            res.raise_for_status()
            data = res.json()
            break
        except (httpx.HTTPError, ValueError) as e:
            exc = e
            time.sleep(0.6 * (attempt + 1))
    if data is None:
        if hit:  # serve stale rather than fail
            return hit[1]
        raise HTTPException(status_code=502, detail="The catalogue is unavailable right now") from exc
    if len(_cache) > 200:
        _cache.clear()
    _cache[key] = (time.time(), data)
    return data


@router.get("/gutenberg")
def gutenberg(user: CurrentUser, q: str = Query("", max_length=120), topic: str = Query("", max_length=60),
              page: int = Query(1, ge=1, le=500), sort: Literal["popular", "descending"] = "popular"):
    params: dict = {"page": page}
    if sort != "popular":
        params["sort"] = sort
    if q:
        params["search"] = q
    if topic:
        params["topic"] = topic
    return _get_json("https://gutendex.com/books/", params)


@router.get("/new")
def new_arrivals(user: CurrentUser):
    """Newest Gutenberg additions, newest LibriVox recordings and the current top podcasts."""
    out: dict = {}
    try:
        out["gutenberg"] = _get_json("https://gutendex.com/books/", {"sort": "descending", "languages": "en"})
    except HTTPException:
        out["gutenberg"] = None
    try:
        out["librivox"] = _get_json("https://archive.org/advancedsearch.php", {
            "q": "collection:librivoxaudio AND mediatype:audio", "fl[]": ["identifier", "title", "creator", "addeddate", "downloads"],
            "sort[]": "addeddate desc", "rows": 24, "output": "json",
        })
    except HTTPException:
        out["librivox"] = None
    try:
        out["podcasts"] = _get_json("https://rss.marketingtools.apple.com/api/v2/us/podcasts/top/24/podcasts.json")
    except HTTPException:
        out["podcasts"] = None
    return out
