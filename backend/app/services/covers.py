"""Cover artwork: pull an EPUB's embedded cover, validate user-uploaded images, and store them per document."""
from __future__ import annotations

import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from . import storage

MAX_COVER_BYTES = 4 * 1024 * 1024
_MAGIC = ((b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpg"), (b"GIF8", "gif"))
MEDIA_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


def sniff(data: bytes) -> str | None:
    """Image type from the bytes themselves (never trust a filename or Content-Type)."""
    for magic, ext in _MAGIC:
        if data.startswith(magic):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def epub_cover(path: Path) -> bytes | None:
    """The cover image declared by an EPUB package (EPUB 2 `<meta name="cover">` or EPUB 3 `properties="cover-image"`)."""
    try:
        with zipfile.ZipFile(path) as zf:
            container = ElementTree.fromstring(zf.read("META-INF/container.xml"))
            ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
            rootfile = container.find(".//c:rootfile", ns)
            if rootfile is None:
                return None
            opf_path = rootfile.attrib["full-path"]
            opf = ElementTree.fromstring(zf.read(opf_path))
            opf_ns = {"opf": "http://www.idpf.org/2007/opf"}
            items = opf.findall(".//opf:manifest/opf:item", opf_ns)
            href = next((i.attrib.get("href") for i in items if "cover-image" in (i.attrib.get("properties") or "").split()), None)
            if not href:
                meta = next((m for m in opf.findall(".//opf:metadata/opf:meta", opf_ns) if m.attrib.get("name") == "cover"), None)
                if meta is not None:
                    href = next((i.attrib.get("href") for i in items if i.attrib.get("id") == meta.attrib.get("content")), None)
            if not href:
                return None
            member = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), href.split("#")[0]))
            info = zf.getinfo(member)
            if info.file_size > MAX_COVER_BYTES:
                return None
            data = zf.read(member)
            return data if sniff(data) else None
    except Exception:  # noqa: BLE001 - a broken cover must never fail the import
        return None


def save_cover(owner_id: str, document_id: str, data: bytes) -> str:
    ext = sniff(data)
    if not ext:
        raise ValueError("Cover must be a PNG, JPEG, WebP or GIF image")
    if len(data) > MAX_COVER_BYTES:
        raise ValueError("Cover images must be 4 MB or smaller")
    return storage.save(owner_id, "covers", f"{document_id}.{ext}", data)
