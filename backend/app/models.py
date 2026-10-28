"""ORM models."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))  # "!" = no password (Google-only account)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Document(TimestampMixin, Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    author: Mapped[str] = mapped_column(String(200), default="Unknown author")
    doc_type: Mapped[str] = mapped_column(String(20), default="DOCUMENT")  # BOOK | PAPER | DOCUMENT
    file_format: Mapped[str] = mapped_column(String(10), default="TXT")
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    color: Mapped[str] = mapped_column(String(20), default="coral")
    status: Mapped[str] = mapped_column(String(20), default="ready")  # processing | ready | failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    offline: Mapped[bool] = mapped_column(Boolean, default=False)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    current_chapter: Mapped[int] = mapped_column(Integer, default=0)
    scroll_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    last_mode: Mapped[str] = mapped_column(String(20), default="Reader")
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    chapters: Mapped[list[Chapter]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="Chapter.position"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    word_count: Mapped[int] = mapped_column(Integer, default=0)

    document: Mapped[Document] = relationship(back_populates="chapters")


class Highlight(TimestampMixin, Base):
    __tablename__ = "highlights"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chapter_index: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30), default="Important")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class Sketch(TimestampMixin, Base):
    """One pen / marker stroke drawn over a chapter page. Points are [x, y, pressure] with x, y in 0..1 of the page."""

    __tablename__ = "sketches"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chapter_index: Mapped[int] = mapped_column(Integer, default=0)
    tool: Mapped[str] = mapped_column(String(10), default="pen")
    color: Mapped[str] = mapped_column(String(9), default="#ff3b6b")
    width: Mapped[float] = mapped_column(Float, default=3.0)
    points: Mapped[list] = mapped_column(JSON)


class Note(TimestampMixin, Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    chapter_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(30), default="Note")
    # note | highlight | ai_insight | summary | mindmap | diagram | quiz | explanation
    note_type: Mapped[str] = mapped_column(String(20), default="note")
    ai_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)


class Bookmark(TimestampMixin, Base):
    __tablename__ = "bookmarks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    chapter_index: Mapped[int] = mapped_column(Integer, default=0)
    scroll_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    label: Mapped[str] = mapped_column(String(300), default="Bookmark")


class ReadingSession(Base):
    __tablename__ = "reading_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="reading")  # reading | focus | listening
    mode: Mapped[str] = mapped_column(String(20), default="Reader")
    seconds: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Job(TimestampMixin, Base):
    """Background job (document processing, audiobook generation, ...)."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | processing | completed | failed
    stage: Mapped[str] = mapped_column(String(160), default="Queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    seen: Mapped[bool] = mapped_column(Boolean, default=False)


class Audiobook(TimestampMixin, Base):
    __tablename__ = "audiobooks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    tone: Mapped[str] = mapped_column(String(20), default="Regular")
    voice: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    # [{index, title, segments: [{text, pause_ms}], seconds}]
    script: Mapped[list] = mapped_column(JSON, default=list)
    rate: Mapped[float] = mapped_column(Float, default=1.0)
    pitch: Mapped[float] = mapped_column(Float, default=1.0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    position_chapter: Mapped[int] = mapped_column(Integer, default=0)
    position_segment: Mapped[int] = mapped_column(Integer, default=0)
    listened_seconds: Mapped[int] = mapped_column(Integer, default=0)
    bookmarks: Mapped[list] = mapped_column(JSON, default=list)


class CollabProject(TimestampMixin, Base):
    __tablename__ = "collab_projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    collaborators: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, email, role}]
    # [{id, chapter_index, title, collaborator_id, status, recording_id}]
    assignments: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="recording")


class Recording(TimestampMixin, Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("collab_projects.id", ondelete="CASCADE"), index=True)
    assignment_id: Mapped[str] = mapped_column(String(32))
    file_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(80), default="audio/webm")
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)


class ResearchProject(TimestampMixin, Base):
    __tablename__ = "research_projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    topic: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="exploring")  # exploring | drafting | review | complete
    citation_style: Mapped[str] = mapped_column(String(10), default="APA")
    tone: Mapped[str] = mapped_column(String(30), default="academic")
    depth: Mapped[str] = mapped_column(String(20), default="standard")
    source_document_ids: Mapped[list] = mapped_column(JSON, default=list)
    outline: Mapped[list] = mapped_column(JSON, default=list)
    # key -> {content, status, versions: [{content, created_at, action}]}
    sections: Mapped[dict] = mapped_column(JSON, default=dict)

    references: Mapped[list[Reference]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Reference.relevance.desc()"
    )


class Reference(Base):
    __tablename__ = "references"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("research_projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list] = mapped_column(JSON, default=list)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(300), nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(800), nullable=True)
    doi: Mapped[str | None] = mapped_column(String(200), nullable=True)
    citations: Mapped[int] = mapped_column(Integer, default=0)
    relevance: Mapped[float] = mapped_column(Float, default=0.0)
    provider: Mapped[str] = mapped_column(String(40), default="Manual")
    publication_type: Mapped[str] = mapped_column(String(40), default="Article")
    open_access: Mapped[bool] = mapped_column(Boolean, default=False)
    included: Mapped[bool] = mapped_column(Boolean, default=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[ResearchProject] = relationship(back_populates="references")


class Deck(TimestampMixin, Base):
    """A generated presentation. `slides` is a list of layout-tagged slide dicts (see services/deck.py)."""

    __tablename__ = "decks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    subtitle: Mapped[str] = mapped_column(String(400), default="")
    theme: Mapped[str] = mapped_column(String(20), default="aurora")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    slides: Mapped[list] = mapped_column(JSON, default=list)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
