"""Shared FastAPI dependencies."""
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Document, User
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def get_current_user(
    request: Request,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    token: Annotated[str | None, Query(include_in_schema=False)] = None,
) -> User:
    # A query-string token is accepted so <audio>/<a download> elements can fetch protected files.
    raw = credentials.credentials if credentials else token
    user_id = decode_access_token(raw) if raw else None
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    request.state.user_id = user.id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_owned_document(db: Session, user: User, document_id: str) -> Document:
    doc = db.get(Document, document_id)
    if not doc or doc.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def get_owned(db: Session, model, user: User, obj_id: str, label: str = "Resource"):
    obj = db.get(model, obj_id)
    if not obj or getattr(obj, "owner_id", None) != user.id:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj
