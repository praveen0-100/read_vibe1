"""Original-document rendering for formats a browser cannot show natively (DOCX, plain text, Markdown).

Returns structured blocks (headings, paragraphs, tables) built from the stored upload, so the reader's "Original" view shows
the source as written rather than the reflowed extraction. PDFs are shown by the browser itself and EPUB/PPTX are not
rendered here. Blocks are data (the client escapes them); no HTML from the file is ever passed through.
"""
from __future__ import annotations

import re
from pathlib import Path

MAX_BLOCKS = 4000
MAX_CHARS = 1_500_000
RENDERABLE = {"docx", "txt", "md", "markdown", "log", "rst", "tex"}


def can_render(file_format: str) -> bool:
    return file_format.lower() in RENDERABLE


def _text_blocks(raw: str, markdown: bool) -> list[dict]:
    blocks: list[dict] = []
    for chunk in re.split(r"\n\s*\n", raw):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", chunk) if markdown else None
        if m and "\n" not in chunk:
            blocks.append({"type": "heading", "level": len(m.group(1)), "text": m.group(2).strip()})
        else:
            blocks.append({"type": "paragraph", "text": chunk.strip()})
    return blocks


def _docx_blocks(path: Path) -> list[dict]:
    import docx

    d = docx.Document(str(path))
    blocks: list[dict] = []
    for para in d.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style = (para.style.name or "").lower() if para.style is not None else ""
        if style.startswith("heading") or style == "title":
            digits = re.findall(r"\d", style)
            blocks.append({"type": "heading", "level": int(digits[0]) if digits else 1, "text": text})
        else:
            blocks.append({"type": "paragraph", "text": text})
    for table in d.tables:
        rows = [[c.text.strip() for c in row.cells] for row in table.rows]
        if rows:
            blocks.append({"type": "table", "rows": rows})
    return blocks


def render(path: Path, file_format: str) -> dict:
    fmt = file_format.lower()
    if fmt == "docx":
        blocks = _docx_blocks(path)
    else:
        raw = path.read_bytes()[:MAX_CHARS].decode("utf-8", errors="replace")
        blocks = _text_blocks(raw, markdown=fmt in ("md", "markdown"))
    return {"format": fmt.upper(), "blocks": blocks[:MAX_BLOCKS], "truncated": len(blocks) > MAX_BLOCKS}
