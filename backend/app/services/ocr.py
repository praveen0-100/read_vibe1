"""Optional OCR for scanned PDFs.

ReadVibe needs no OCR engine to run. When the server has Tesseract (`pytesseract` + the `tesseract` binary) and
`pypdfium2` for rendering pages, scanned PDFs are recognised page by page; otherwise the importer reports exactly what is
missing instead of failing mysteriously. Tests (and deployments with another engine) can plug one in with `set_engine`.
"""
from __future__ import annotations

import io
import logging
import shutil
from collections.abc import Callable

log = logging.getLogger("readvibe.ocr")

MAX_PAGES = 400
RENDER_SCALE = 2.0  # ~144 dpi: readable for Tesseract without exploding memory

# engine(pdf_source, max_pages, languages) -> one text per page
Engine = Callable[[object, int, str], list[str]]
_engine: Engine | None = None


def set_engine(engine: Engine | None) -> None:
    global _engine
    _engine = engine


def _tesseract_ready() -> bool:
    try:
        import pypdfium2  # noqa: F401
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def available() -> bool:
    return _engine is not None or _tesseract_ready()


def missing_reason() -> str:
    return (
        "This PDF has no selectable text (it looks like a scanned image), and this server has no OCR engine. "
        "Install Tesseract and `pip install pytesseract pypdfium2` on the server to import scanned PDFs, "
        "or run OCR on the file first and upload the result."
    )


def _tesseract_engine(source, max_pages: int, languages: str) -> list[str]:
    import pypdfium2 as pdfium
    import pytesseract

    pdf = pdfium.PdfDocument(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else str(source))
    pages: list[str] = []
    try:
        for i in range(min(len(pdf), max_pages)):
            image = pdf[i].render(scale=RENDER_SCALE).to_pil()
            pages.append(pytesseract.image_to_string(image, lang=languages) or "")
    finally:
        pdf.close()
    return pages


def recognize(source, languages: str = "eng") -> list[str] | None:
    """Per-page text for a scanned PDF, or None when no engine is available or recognition failed."""
    engine = _engine or (_tesseract_engine if _tesseract_ready() else None)
    if engine is None:
        return None
    try:
        return engine(source, MAX_PAGES, languages)
    except Exception as exc:  # noqa: BLE001 - OCR problems must surface as a clear import error, not a 500
        log.warning("OCR failed: %s", exc)
        return None
