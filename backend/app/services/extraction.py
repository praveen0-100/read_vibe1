"""Text extraction and chapter segmentation for PDF, EPUB, DOCX, PPTX, ODT, TXT, Markdown, CSV and HTML."""
from __future__ import annotations

import io
import posixpath
import html
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from xml.etree import ElementTree

SUPPORTED_FORMATS = {"pdf", "epub", "docx", "pptx", "odt", "txt", "md", "markdown", "html", "htm", "rtf", "csv", "xml", "json", "yaml", "yml", "log", "tex", "rst"}

_CHAPTER_RE = re.compile(
    r"^\s*(?:(?:chapter|part|book|section)\s+(?:[0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b.{0,80}"
    # "Chapter N" in Indian languages: Tamil, Telugu, Malayalam, Kannada, Hindi/Marathi, Bengali, Gujarati, Punjabi, Odia, Urdu
    r"|(?:அத்தியாயம்|பாகம்|பகுதி|అధ్యాయం|భాగం|അധ്യായം|ഭാഗം|ಅಧ್ಯಾಯ|ಭಾಗ|अध्याय|भाग|অধ্যায়|પ્રકરણ|ਅਧਿਆਇ|ଅଧ୍ୟାୟ|باب|فصل)"
    r"\s*[0-9०-९০-৯੦-੯૦-૯௦-௯౦-౯೦-೯൦-൯]+.{0,80}"
    r"|(?:abstract|introduction|background|related work|literature review|methodology|methods|results|discussion|"
    r"conclusions?|references|acknowledg(?:e)?ments|prologue|epilogue|preface|foreword|appendix(?:\s+[a-z0-9]+)?)\s*$"
    r"|[0-9]{1,2}\.?\s+[A-Z][A-Za-z ,:'&-]{2,70}$)",
    re.IGNORECASE,
)
_MD_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
TARGET_SECTION_WORDS = 2200
# Uploads may be up to 5 GB (mostly images/scans in big files). Readable text is capped so a single
# document stays responsive in the reader, search and AI tools.
MAX_TEXT_CHARS = 30_000_000
MAX_TEXT_BYTES = 32 * 1024 * 1024  # ~5M words — far beyond any book (War and Peace is ~3 MB)


def _binary(src):
    """Binary readers accept either raw bytes or a filesystem path (streams large files from disk)."""
    return io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else str(src)


def _text_bytes(src) -> tuple[bytes, bool]:
    if isinstance(src, (bytes, bytearray)):
        return bytes(src[:MAX_TEXT_BYTES]), len(src) > MAX_TEXT_BYTES
    with open(src, "rb") as fh:
        data = fh.read(MAX_TEXT_BYTES + 1)
    return data[:MAX_TEXT_BYTES], len(data) > MAX_TEXT_BYTES


class ExtractionError(Exception):
    pass


@dataclass
class ExtractedChapter:
    title: str
    content: str

    @property
    def word_count(self) -> int:
        return len(self.content.split())


@dataclass
class ExtractedDocument:
    title: str | None = None
    author: str | None = None
    chapters: list[ExtractedChapter] = field(default_factory=list)
    truncated: bool = False

    @property
    def word_count(self) -> int:
        return sum(c.word_count for c in self.chapters)


# ─── Text cleanup ─────────────────────────────────────────────────────────────
def normalize_paragraphs(text: str) -> str:
    """Join hard-wrapped lines into paragraphs and normalise whitespace."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # de-hyphenate line breaks
    blocks = re.split(r"\n\s*\n", text)
    paragraphs: list[str] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        merged = lines[0]
        for ln in lines[1:]:
            # keep list items / headings on their own line
            if re.match(r"^([-*•]|\d+[.)])\s", ln) or (len(ln) < 60 and ln.isupper()):
                paragraphs.append(merged)
                merged = ln
            else:
                merged += " " + ln
        paragraphs.append(merged)
    return "\n\n".join(p for p in paragraphs if p)


def _is_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 90:
        return False
    if _CHAPTER_RE.match(s):
        return True
    words = s.split()
    return 1 <= len(words) <= 8 and s.isupper() and any(c.isalpha() for c in s) and not s.endswith((".", ","))


def split_into_chapters(text: str, fallback_title: str = "Section") -> list[ExtractedChapter]:
    """Split plain text into chapters using heading heuristics, falling back to word-count sections."""
    text = normalize_paragraphs(re.sub(r"(?m)^(#{1,3}\s+\S.*)$", r"\n\1\n", text))  # a heading line directly above its text still splits
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    chapters: list[ExtractedChapter] = []
    current_title: str | None = None
    buffer: list[str] = []

    def flush():
        body = "\n\n".join(buffer).strip()
        if body:
            chapters.append(ExtractedChapter(current_title or fallback_title, body))

    for para in paragraphs:
        md = _MD_HEADING_RE.match(para)
        heading = md.group(2) if md else (para if _is_heading(para) else None)
        if heading:
            if buffer:
                flush()
                buffer = []
            elif current_title and not chapters:
                # consecutive headings: combine ("CHAPTER ONE" + "The Beginning")
                heading = f"{current_title} · {heading}"
            current_title = heading.strip().strip("#").strip()
            continue
        buffer.append(para)
    flush()

    if len(chapters) <= 1:
        return _chunk_by_words("\n\n".join(paragraphs), chapters[0].title if chapters else fallback_title)
    # merge tiny chapters into the previous one
    merged: list[ExtractedChapter] = []
    for ch in chapters:
        if merged and ch.word_count < 40:
            merged[-1].content += "\n\n" + ch.title + "\n\n" + ch.content
        else:
            merged.append(ch)
    return _split_oversized(merged)


def _chunk_by_words(text: str, base_title: str) -> list[ExtractedChapter]:
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return []
    total = sum(len(p.split()) for p in paragraphs)
    if total <= TARGET_SECTION_WORDS * 1.3:
        return [ExtractedChapter(base_title if base_title != "Section" else "Full text", "\n\n".join(paragraphs))]
    sections: list[ExtractedChapter] = []
    buf: list[str] = []
    count = 0
    for p in paragraphs:
        buf.append(p)
        count += len(p.split())
        if count >= TARGET_SECTION_WORDS:
            sections.append(ExtractedChapter(_auto_title(buf, len(sections) + 1), "\n\n".join(buf)))
            buf, count = [], 0
    if buf:
        if sections and count < TARGET_SECTION_WORDS * 0.3:
            sections[-1].content += "\n\n" + "\n\n".join(buf)
        else:
            sections.append(ExtractedChapter(_auto_title(buf, len(sections) + 1), "\n\n".join(buf)))
    return sections


def _split_oversized(chapters: list[ExtractedChapter]) -> list[ExtractedChapter]:
    out: list[ExtractedChapter] = []
    for ch in chapters:
        if ch.word_count > TARGET_SECTION_WORDS * 4:
            parts = _chunk_by_words(ch.content, ch.title)
            for i, part in enumerate(parts, 1):
                out.append(ExtractedChapter(f"{ch.title} ({i}/{len(parts)})", part.content))
        else:
            out.append(ch)
    return out


def _auto_title(paragraphs: list[str], n: int) -> str:
    first = re.split(r"(?<=[.!?])\s", paragraphs[0].strip(), maxsplit=1)[0]
    words = first.split()[:7]
    snippet = " ".join(words).rstrip(",;:")
    return f"Part {n} · {snippet}{'…' if len(first.split()) > 7 else ''}"


# ─── Format readers ───────────────────────────────────────────────────────────
class _HTMLText(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "blockquote"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0
        self.headings: list[str] = []
        self._in_heading = False
        self._heading_buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head", "nav"):
            self.skip += 1
        if tag in ("h1", "h2", "h3"):
            self._in_heading = True
            self._heading_buf = []
            self.parts.append("\n\n## ")
        elif tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head", "nav") and self.skip:
            self.skip -= 1
        if tag in ("h1", "h2", "h3") and self._in_heading:
            self._in_heading = False
            self.headings.append(" ".join("".join(self._heading_buf).split()))
            self.parts.append("\n\n")
        elif tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_data(self, data):
        if self.skip:
            return
        if self._in_heading:
            self._heading_buf.append(data)
            self.parts.append(" ".join(data.split()))
        else:
            self.parts.append(re.sub(r"\s+", " ", data))

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r"[ \t]+\n", "\n", raw)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def html_to_text(html: str) -> tuple[str, list[str]]:
    parser = _HTMLText()
    parser.feed(html)
    return parser.text(), parser.headings


def _read_pdf(data) -> ExtractedDocument:
    from pypdf import PdfReader

    try:
        reader = PdfReader(_binary(data))
        if reader.is_encrypted:
            reader.decrypt("")
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"Could not open PDF: {exc}") from exc

    meta = reader.metadata or {}
    pages = []
    chars = 0
    truncated = False
    for page in reader.pages:
        if chars > MAX_TEXT_CHARS:
            truncated = True
            break
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            text = ""
        pages.append(text)
        chars += len(text)
    full = "\n\n".join(pages)
    if len(full.split()) < 20:
        raise ExtractionError(
            "This PDF has no selectable text (it may be a scanned image). Run OCR on it first, then upload again."
        )

    doc = ExtractedDocument(
        title=(meta.get("/Title") or "").strip() or None,
        author=(meta.get("/Author") or "").strip() or None,
        truncated=truncated,
    )
    # Prefer the PDF outline (bookmarks) for chapters when present.
    try:
        outline = [o for o in reader.outline if not isinstance(o, list)]
        marks = []
        for item in outline:
            page_no = reader.get_destination_page_number(item)
            marks.append((page_no, str(item.title).strip()))
        marks = sorted({m for m in marks if m[1]}, key=lambda m: m[0])
    except Exception:  # noqa: BLE001
        marks = []
    if len(marks) >= 2:
        for i, (start, title) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(pages)
            body = normalize_paragraphs("\n\n".join(pages[start:max(end, start + 1)]))
            if body.strip():
                doc.chapters.append(ExtractedChapter(title, body))
        if doc.chapters:
            if marks[0][0] > 0:
                front = normalize_paragraphs("\n\n".join(pages[: marks[0][0]]))
                if len(front.split()) > 60:
                    doc.chapters.insert(0, ExtractedChapter("Front matter", front))
            return doc
    doc.chapters = split_into_chapters(full)
    return doc


def _read_docx(data) -> ExtractedDocument:
    import docx

    try:
        d = docx.Document(_binary(data))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"Could not open DOCX: {exc}") from exc
    props = d.core_properties
    lines: list[str] = []
    for para in d.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style = (para.style.name or "").lower() if para.style is not None else ""
        if style.startswith("heading") or style == "title":
            level = re.findall(r"\d", style)
            if style == "title" or (level and int(level[0]) <= 2):
                lines.append(f"## {text}")
                continue
        lines.append(text)
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                lines.append(" | ".join(cells))
    return ExtractedDocument(
        title=(props.title or "").strip() or None,
        author=(props.author or "").strip() or None,
        chapters=split_into_chapters("\n\n".join(lines)),
    )


_A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def _slide_paragraphs(root) -> list[str]:
    """Visible text of one slide/notes part, one entry per text paragraph."""
    out = []
    for para in root.iter(f"{_A_NS}p"):
        text = "".join(t.text or "" for t in para.iter(f"{_A_NS}t")).strip()
        if text:
            out.append(text)
    return out


def _read_pptx(data) -> ExtractedDocument:
    """Slides become sections (title + body + speaker notes), in presentation order."""
    try:
        zf = zipfile.ZipFile(_binary(data))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"Could not open PPTX: {exc}") from exc
    with zf:
        names = set(zf.namelist())
        slides = sorted(
            (n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
            key=lambda n: int(re.findall(r"\d+", n)[-1]),
        )
        if not slides:
            raise ExtractionError("No slides found in this PPTX")
        sections: list[str] = []
        for number, name in enumerate(slides, start=1):
            try:
                root = ElementTree.fromstring(zf.read(name))
            except ElementTree.ParseError:
                continue
            title = ""
            body: list[str] = []
            for shape in root.iter(f"{_P_NS}sp"):
                ph = shape.find(f".//{_P_NS}ph")
                lines = _slide_paragraphs(shape)
                if not lines:
                    continue
                if ph is not None and ph.get("type") in ("title", "ctrTitle") and not title:
                    title = " ".join(lines)
                else:
                    body.extend(lines)
            for table in root.iter(f"{_A_NS}tbl"):  # tables: one row per line
                for row in table.iter(f"{_A_NS}tr"):
                    cells = [" ".join(_slide_paragraphs(c)) for c in row.iter(f"{_A_NS}tc")]
                    cells = [c for c in cells if c]
                    if cells:
                        body.append(" | ".join(cells))
            notes: list[str] = []
            rels = f"ppt/slides/_rels/{posixpath.basename(name)}.rels"
            if rels in names:
                match = re.search(r'Target="[^"]*(notesSlides/[^"]+\.xml)"', zf.read(rels).decode("utf-8", errors="ignore"))
                note_part = f"ppt/{match.group(1)}" if match else ""
                if note_part in names:
                    try:
                        notes = _slide_paragraphs(ElementTree.fromstring(zf.read(note_part)))
                    except ElementTree.ParseError:
                        notes = []
                    notes = [n for n in notes if not n.isdigit()]  # drop the slide-number placeholder
            parts = [f"## {title or f'Slide {number}'}"] + body
            if notes:
                parts.append("Speaker notes: " + " ".join(notes))
            sections.append("\n\n".join(parts))
    return ExtractedDocument(chapters=split_into_chapters("\n\n".join(sections)))


def _read_odt(data) -> ExtractedDocument:
    ns = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    try:
        with zipfile.ZipFile(_binary(data)) as zf:
            root = ElementTree.fromstring(zf.read("content.xml"))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"Could not open ODT: {exc}") from exc
    lines: list[str] = []
    for el in root.iter():
        if el.tag in (f"{ns}h", f"{ns}p"):
            text = "".join(el.itertext()).strip()
            if text:
                lines.append(f"## {text}" if el.tag == f"{ns}h" else text)
    return ExtractedDocument(chapters=split_into_chapters("\n\n".join(lines)))


def _read_epub(data) -> ExtractedDocument:
    try:
        zf = zipfile.ZipFile(_binary(data))
        container = ElementTree.fromstring(zf.read("META-INF/container.xml"))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"Could not open EPUB: {exc}") from exc
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    rootfile = container.find(".//c:rootfile", ns)
    if rootfile is None:
        raise ExtractionError("EPUB is missing its package file")
    opf_path = rootfile.attrib["full-path"]
    opf = ElementTree.fromstring(zf.read(opf_path))
    opf_dir = posixpath.dirname(opf_path)
    opf_ns = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}
    title_el = opf.find(".//dc:title", opf_ns)
    author_el = opf.find(".//dc:creator", opf_ns)
    manifest = {
        item.attrib["id"]: item.attrib["href"]
        for item in opf.findall(".//opf:manifest/opf:item", opf_ns)
        if "href" in item.attrib
    }
    spine = [i.attrib["idref"] for i in opf.findall(".//opf:spine/opf:itemref", opf_ns)]

    doc = ExtractedDocument(
        title=title_el.text.strip() if title_el is not None and title_el.text else None,
        author=author_el.text.strip() if author_el is not None and author_el.text else None,
    )
    for idref in spine:
        href = manifest.get(idref)
        if not href:
            continue
        path = posixpath.normpath(posixpath.join(opf_dir, href.split("#")[0]))
        try:
            html = zf.read(path).decode("utf-8", errors="ignore")
        except KeyError:
            continue
        text, headings = html_to_text(html)
        text = re.sub(r"^## .*$", "", text, flags=re.MULTILINE) if headings else text
        body = normalize_paragraphs(text)
        if len(body.split()) < 30:
            continue
        title = headings[0] if headings else _auto_title(body.split("\n\n"), len(doc.chapters) + 1)
        doc.chapters.append(ExtractedChapter(title[:200], body))
    if not doc.chapters:
        raise ExtractionError("No readable text found in this EPUB")
    doc.chapters = _split_oversized(doc.chapters)
    return doc


def _read_rtf(data: bytes) -> str:
    text = data.decode("latin-1", errors="ignore")
    text = re.sub(r"\\par[d]?", "\n\n", text)
    text = re.sub(r"\{\\\*[^{}]*\}", "", text)
    text = re.sub(r"\\'[0-9a-f]{2}", "", text)
    text = re.sub(r"\\[a-z]+-?\d* ?", "", text)
    return text.replace("{", "").replace("}", "")


def _read_xml(xml: str) -> str:
    """Readable text of an XML file. Tags are stripped with a regex rather than parsed, so entity-expansion tricks never run."""
    xml = re.sub(r"<!\[CDATA\[(.*?)\]\]>", lambda m: m.group(1), xml, flags=re.S)
    xml = re.sub(r"<!--.*?-->|<\?.*?\?>|<!DOCTYPE[^>]*>", " ", xml, flags=re.S)
    xml = re.sub(r"</(?:p|para|paragraph|title|heading|h\d|section|item|entry|row|li|div|br)\s*>|<br\s*/?>", "\n\n", xml, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", xml))
    return normalize_paragraphs(re.sub(r"[ \t]+", " ", text))


def extract(filename: str, data) -> ExtractedDocument:
    """`data` is the file's bytes or a path to it on disk (preferred for large uploads)."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "txt"
    if ext not in SUPPORTED_FORMATS:
        raise ExtractionError(f"Unsupported file type .{ext}")
    if ext == "pdf":
        doc = _read_pdf(data)
    elif ext == "docx":
        doc = _read_docx(data)
    elif ext == "epub":
        doc = _read_epub(data)
    elif ext == "pptx":
        doc = _read_pptx(data)
    elif ext == "odt":
        doc = _read_odt(data)
    else:
        raw, truncated = _text_bytes(data)
        if ext in ("html", "htm"):
            text, _ = html_to_text(raw.decode("utf-8", errors="ignore"))
        elif ext == "rtf":
            text = _read_rtf(raw)
        elif ext == "xml":
            text = _read_xml(raw.decode("utf-8", errors="ignore"))
        elif raw.startswith(b"\xff\xfe"):
            text = raw.decode("utf-16", errors="ignore")
        else:
            text = raw.decode("utf-8", errors="ignore")
        doc = ExtractedDocument(chapters=split_into_chapters(text), truncated=truncated)
    doc.chapters = [c for c in doc.chapters if c.content.strip()]
    if not doc.chapters:
        raise ExtractionError("No readable text was found in this document")
    return doc


def guess_doc_type(doc: ExtractedDocument, filename: str) -> str:
    titles = " ".join(c.title.lower() for c in doc.chapters)
    if any(k in titles for k in ("abstract", "methodology", "literature review", "references")) and doc.word_count < 30000:
        return "PAPER"
    if doc.word_count > 25000 or any("chapter" in c.title.lower() for c in doc.chapters):
        return "BOOK"
    return "DOCUMENT"
