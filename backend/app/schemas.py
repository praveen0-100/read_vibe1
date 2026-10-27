"""Pydantic request schemas."""
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

HighlightCategory = Literal["Important", "Question", "Definition", "Exam", "Research"]
Depth = Literal["brief", "standard", "deep"]
ExplainMode = Literal["simple", "student", "expert", "example", "analogy"]
Tone = Literal["Regular", "Humor", "Tough"]


# ─── Auth ─────────────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class PreferencesUpdate(BaseModel):
    preferences: dict


# ─── Documents ────────────────────────────────────────────────────────────────
class DocumentCreateText(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="You", max_length=200)
    content: str = Field(min_length=1)
    doc_type: Literal["BOOK", "PAPER", "DOCUMENT"] = "DOCUMENT"
    tags: list[str] = []


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    description: str | None = None
    doc_type: Literal["BOOK", "PAPER", "DOCUMENT"] | None = None
    tags: list[str] | None = None
    color: Literal["coral", "blue", "lavender", "amber", "green", "rose"] | None = None
    favorite: bool | None = None
    pinned: bool | None = None
    offline: bool | None = None


class ProgressUpdate(BaseModel):
    chapter_index: int = Field(ge=0)
    scroll_ratio: float = Field(ge=0, le=1)
    mode: Literal["Reader", "Zen", "Vibe"] | None = None


class HighlightCreate(BaseModel):
    chapter_index: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=5000)
    category: HighlightCategory = "Important"
    note: str | None = None


class HighlightUpdate(BaseModel):
    category: HighlightCategory | None = None
    note: str | None = None


class SketchCreate(BaseModel):
    chapter_index: int = Field(ge=0)
    tool: Literal["pen", "marker"] = "pen"
    color: str = Field(default="#ff3b6b", pattern=r"^#[0-9a-fA-F]{6}$")
    width: float = Field(default=3, gt=0, le=40)
    points: list[list[float]] = Field(min_length=1, max_length=5000)


class BookmarkCreate(BaseModel):
    chapter_index: int = Field(ge=0)
    scroll_ratio: float = Field(default=0, ge=0, le=1)
    label: str = Field(default="Bookmark", max_length=300)


# ─── Notes ────────────────────────────────────────────────────────────────────
class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str = ""
    quote: str | None = None
    category: str = Field(default="Note", max_length=30)
    note_type: str = Field(default="note", max_length=20)
    document_id: str | None = None
    chapter_index: int | None = None
    ai_payload: dict | None = None


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = None
    category: str | None = Field(default=None, max_length=30)
    pinned: bool | None = None


# ─── Sessions / stats ─────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    document_id: str | None = None
    kind: Literal["reading", "focus", "listening"] = "reading"
    mode: str = "Reader"
    seconds: int = Field(ge=1, le=60 * 60 * 6)


# ─── AI ───────────────────────────────────────────────────────────────────────
class AIScope(BaseModel):
    document_id: str
    chapter_index: int | None = None  # None = whole document


class SummarizeIn(AIScope):
    depth: Depth = "standard"


class ExplainIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    mode: ExplainMode = "simple"
    document_id: str | None = None


class DefineIn(BaseModel):
    term: str = Field(min_length=1, max_length=200)
    document_id: str | None = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatIn(AIScope):
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = []
    selection: str | None = None


class MindMapIn(AIScope):
    pass


class DiagramIn(AIScope):
    kind: Literal["flowchart", "concept", "block"] = "flowchart"
    text: str | None = None
    layout: Literal["TD", "LR"] = "TD"
    detail: Literal["simple", "standard", "detailed"] = "standard"


class QuizIn(AIScope):
    count: int = Field(default=6, ge=2, le=15)


class VisualIn(BaseModel):
    query: str = Field(min_length=1, max_length=200)


class CompareIn(AIScope):
    concept_a: str = Field(min_length=1, max_length=200)
    concept_b: str = Field(min_length=1, max_length=200)


# ─── Audio ────────────────────────────────────────────────────────────────────
class AudiobookCreate(BaseModel):
    document_id: str
    tone: Tone = "Regular"
    voice: str | None = None
    rate: float = Field(default=1.0, ge=0.5, le=3.0)
    chapter_indexes: list[int] | None = None


class AudiobookUpdate(BaseModel):
    position_chapter: int | None = Field(default=None, ge=0)
    position_segment: int | None = Field(default=None, ge=0)
    rate: float | None = Field(default=None, ge=0.5, le=3.0)
    voice: str | None = None
    listened_seconds: int | None = Field(default=None, ge=0)
    bookmarks: list[dict] | None = None


class PreviewIn(BaseModel):
    tone: Tone = "Regular"
    text: str | None = None


class CollabCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    document_id: str | None = None


class Collaborator(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(default="", max_length=255)
    role: str = Field(default="Narrator", max_length=60)


class CollabUpdate(BaseModel):
    title: str | None = None
    collaborators: list[dict] | None = None
    assignments: list[dict] | None = None
    status: str | None = None


# ─── Research ─────────────────────────────────────────────────────────────────
class ResearchCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    topic: str = Field(min_length=3, max_length=2000)
    source_document_ids: list[str] = []


class ResearchUpdate(BaseModel):
    title: str | None = None
    topic: str | None = None
    status: Literal["exploring", "drafting", "review", "complete"] | None = None
    citation_style: Literal["APA", "IEEE", "MLA"] | None = None
    tone: str | None = None
    depth: str | None = None
    source_document_ids: list[str] | None = None
    outline: list[dict] | None = None


class DiscoverIn(BaseModel):
    query: str | None = None
    limit: int = Field(default=12, ge=1, le=40)


class ReferenceCreate(BaseModel):
    title: str = Field(min_length=1)
    authors: list[str] = []
    year: int | None = None
    venue: str | None = None
    url: str | None = None
    doi: str | None = None
    abstract: str | None = None


class ReferenceUpdate(BaseModel):
    included: bool | None = None
    summary: str | None = None


class SectionAction(BaseModel):
    action: Literal["generate", "regenerate", "expand", "shorten", "academic", "cite", "simplify"] = "generate"


class SectionEdit(BaseModel):
    content: str


class ExportIn(BaseModel):
    format: Literal["docx", "pdf", "md"] = "docx"

    @field_validator("format", mode="before")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.lower()


class CastIn(BaseModel):
    names: list[str] = Field(max_length=40)


class TTSIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str | None = Field(default=None, max_length=120)
    emotion: str | None = Field(default=None, max_length=20)  # how the line should sound (see services/tts.PRESETS)
    pitch_shift: int = Field(default=0, ge=-20, le=20)  # Hz; keeps characters in a dialogue apart


class OverviewIn(AIScope):
    language: str = Field(min_length=2, max_length=5)
    format: Literal["conversation", "narrative"] = "conversation"


class TranslateIn(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=80)
    target: str = Field(min_length=2, max_length=5)
    source: str = Field(default="en", min_length=2, max_length=5)
