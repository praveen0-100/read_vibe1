"""Look Up (dictionary + Wikipedia) for the reader's selection sheet."""
from fastapi import APIRouter, HTTPException, Query

from ..deps import CurrentUser
from ..services import lookup as lookup_svc

router = APIRouter(tags=["lookup"])


@router.get("/lookup")
def lookup(_: CurrentUser, term: str = Query(min_length=1, max_length=200), lang: str = Query(default="en", max_length=3),
           context: str = Query(default="", max_length=600)):
    cleaned = lookup_svc.clean_term(term)
    if not cleaned:
        raise HTTPException(status_code=422, detail="Nothing to look up")
    result = lookup_svc.lookup(cleaned, lang)
    # the AI meaning works for phrases, names and every language, and for the word as this passage uses it; it never blocks the rest
    return {**result, "ai": lookup_svc.ai_meaning(cleaned, lang, context)}
