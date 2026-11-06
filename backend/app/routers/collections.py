"""Collections: user-made groups of documents (a shelf). One document can sit on many shelves; removing a shelf never touches the documents."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..deps import DB, CurrentUser, get_owned, get_owned_document
from ..models import Collection, CollectionItem

router = APIRouter(prefix="/collections", tags=["collections"])
MAX_COLLECTIONS = 100
COLORS = ("coral", "blue", "lavender", "amber", "green", "rose")


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=300)
    color: str = "coral"


class CollectionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=300)
    color: str | None = None


class DocIn(BaseModel):
    document_id: str


def out(c: Collection, ids: list[str]) -> dict:
    return {"id": c.id, "name": c.name, "description": c.description, "color": c.color, "document_ids": ids, "count": len(ids)}


def _ids(db, collection_id: str) -> list[str]:
    return list(db.scalars(select(CollectionItem.document_id).where(CollectionItem.collection_id == collection_id).order_by(CollectionItem.position)))


def _check(color: str | None):
    if color is not None and color not in COLORS:
        raise HTTPException(status_code=422, detail=f"color must be one of {', '.join(COLORS)}")


@router.get("")
def list_collections(user: CurrentUser, db: DB):
    rows = db.scalars(select(Collection).where(Collection.owner_id == user.id).order_by(Collection.created_at)).all()
    return [out(c, _ids(db, c.id)) for c in rows]


@router.post("", status_code=201)
def create_collection(body: CollectionIn, user: CurrentUser, db: DB):
    _check(body.color)
    if (db.scalar(select(func.count()).select_from(Collection).where(Collection.owner_id == user.id)) or 0) >= MAX_COLLECTIONS:
        raise HTTPException(status_code=409, detail="You have reached the collection limit")
    c = Collection(owner_id=user.id, name=body.name.strip(), description=body.description.strip(), color=body.color)
    db.add(c)
    db.commit()
    return out(c, [])


@router.patch("/{collection_id}")
def update_collection(collection_id: str, body: CollectionPatch, user: CurrentUser, db: DB):
    c = get_owned(db, Collection, user, collection_id, "Collection")
    data = body.model_dump(exclude_unset=True)
    _check(data.get("color"))
    for k, v in data.items():
        setattr(c, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return out(c, _ids(db, c.id))


@router.delete("/{collection_id}", status_code=204)
def delete_collection(collection_id: str, user: CurrentUser, db: DB):
    c = get_owned(db, Collection, user, collection_id, "Collection")
    db.query(CollectionItem).filter(CollectionItem.collection_id == c.id).delete()  # the shelf goes; the documents stay
    db.delete(c)
    db.commit()


@router.post("/{collection_id}/documents")
def add_document(collection_id: str, body: DocIn, user: CurrentUser, db: DB):
    c = get_owned(db, Collection, user, collection_id, "Collection")
    get_owned_document(db, user, body.document_id)
    ids = _ids(db, c.id)
    if body.document_id not in ids:  # idempotent: adding twice is a no-op, not a duplicate row
        db.add(CollectionItem(collection_id=c.id, document_id=body.document_id, position=len(ids)))
        db.commit()
        ids.append(body.document_id)
    return out(c, ids)


@router.delete("/{collection_id}/documents/{document_id}")
def remove_document(collection_id: str, document_id: str, user: CurrentUser, db: DB):
    c = get_owned(db, Collection, user, collection_id, "Collection")
    db.query(CollectionItem).filter(CollectionItem.collection_id == c.id, CollectionItem.document_id == document_id).delete()
    db.commit()
    return out(c, _ids(db, c.id))
