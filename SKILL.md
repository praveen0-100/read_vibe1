---
name: dk-visual-encyclopedia
description: Create e-books, PDFs and DOCX files in the DK / Smithsonian "Knowledge Encyclopedia" visual style — red running-header bar, bold sans headings, 3-column dense-but-clear text, large high-quality cut-out images with labelled callouts, dark "deep-dive" spreads, big-number facts. Use when the user asks for an e-book, illustrated guide, study material, report, magazine-style PDF or Word file "like the DK encyclopedia template", or wants visually rich, image-led educational content.
---

# DK Visual Encyclopedia — Template & Content Skill

Agent-agnostic: works for any AI agent with Python (reportlab, python-docx, Pillow). Everything needed (design tokens, writing rules, build scripts, QA checklist) is in this one file.

Reference: *Smithsonian Knowledge Encyclopedia* (DK, 2013) — 362 pages, 714 × 853 pt (≈ 9.9 × 11.85 in), InDesign, 300 ppi hero images, Clan Pro type family.

---

## 1. What makes the style (design DNA)

| Element | Rule |
|---|---|
| Page size | 714 × 853 pt (≈ 252 × 301 mm). Alternatives: A4 / US Letter keep the same proportions. |
| Running header | Thin red bar at top. Left→right: **red bold page number**, grey lowercase **section tag** (`space`, `nature`, `reference`), then `◆ TOPIC` in bold caps. |
| Palette | Red `#DE1F4A` (accent, page numbers, big numbers) · Orange `#F58F0F` (section divider pages) · Ink `#1A1A1A` · Grey `#6B6B6B` (captions) · Pale `#F3F3F3` (panels) · Night `#0B0D14` (dark spreads, text white). One accent colour per section; never more than 2 accents on a page. |
| Typography | Original: Clan Pro (News / Bold / Ultra / Black). Free substitutes: **Montserrat/Barlow/Source Sans 3**; fallback Helvetica/Arial. Titles bold, tight leading (≈1.0×); body 9 pt / 12 pt leading; captions 7–7.5 pt. |
| Grid | 3 columns, 36 pt margins, 18 pt gutters. Headings may span 1–2 columns. Text blocks short (3–8 lines), never walls of text. |
| Page types | (1) Cover · (2) Contents · (3) Chapter opener (huge title + intro + collage of cut-outs) · (4) Topic spread (light) · (5) Deep-dive spread (dark, full-bleed image) · (6) Cross-section/anatomy page (one giant image, 8–12 labelled callouts) · (7) Diagram/tree page · (8) Reference pages (glossary, index, timelines) · (9) Colour-block divider. |
| Images | ≥ 300 ppi at print size (≥ 150 ppi min. for screen e-books). Prefer **cut-outs on white/transparent PNG** and glossy 3-D/CG-style renders, NASA-style photos on black. Every image has a caption: **bold label + one grey sentence**. Rounded corners 6 pt on photo panels are OK. Consistent lighting, no watermarks, no stretched ratios, leave white breathing room. |
| Callouts | Thin grey leader line (0.5 pt) from the image feature to a 7.4 pt label: bold name, grey explanation (≤ 25 words). Small coloured dot or circle at the line start. |
| Big-number fact | Giant red number (30–40 pt) + 2-line bold explanation, e.g. **13.8** "billion years since the Big Bang". Max 1–2 per spread. |
| Dark spread | Night background, white text, glowing images, grey-blue captions `#B8BCC8`. Use for dramatic topics (space, deep sea, danger, history of war…). |

---

## 2. Content & writing style (the "content context")

1. **Chapter opener**: 1 huge title (1–3 words) + 3-line **intro in bold** that frames the whole chapter with one striking fact.
2. **Topic block** = ALL-CAPS or bold subhead + 40–90 words. Start with the answer, then explain *how/why*, then one surprising number.
3. Plain, vivid, active voice. Reading age ~12–14, but never childish. Define a term the first time it appears.
4. Use **comparisons to human scale** ("as big as a soccer ball", "10 times faster than a jet").
5. Each spread = 1 hero image + 3–6 small supporting images + 1 fact/number + 1 diagram or timeline where possible.
6. Sentence rhythm: short, short, longer. No filler, no "In this chapter we will…".
7. Facts must be accurate and current; verify numbers; add sources in the back matter. Never invent statistics.
8. Back matter: Glossary (term — one-line definition), Index (alphabetical with page numbers), Credits/Acknowledgements.
9. Front matter: Cover → Half-title → Title page → Copyright/credits → Contents (chapters with page numbers, coloured by section).

### Content skeleton (JSON schema used by the scripts)
```json
{
  "meta": {"title": "My Book", "subtitle": "Encyclopedia", "tagline": "The world as you've never seen it",
           "author": "Name", "cover_image": "assets/cover.png"},
  "sections": [
    {"tag": "space", "title": "The Universe", "theme": "light",
     "intro": "Bold 2–3 sentence framing of the chapter.",
     "blocks": [
       {"type": "h2", "text": "Understanding the Universe"},
       {"type": "p", "text": "40–90 word paragraph…"},
       {"type": "image", "path": "assets/asteroid.png", "caption_title": "Asteroid", "caption": "Rocky lumps left over from…"},
       {"type": "fact", "number": "13.8", "text": "billion years since the Big Bang"},
       {"type": "colbreak"}, {"type": "pagebreak"}
     ]},
    {"tag": "space", "title": "Star death", "theme": "dark", "intro": "…", "blocks": []}
  ]
}
```
`theme`: `light` | `dark`. Block types: `h2`, `p`, `image`, `fact`, `colbreak`, `pagebreak`.

---

## 3. Workflow for any agent

1. **Clarify** (only if unknown): topic, audience, page count, output format (PDF / DOCX / e-book), language.
2. **Outline**: 4–12 chapters → 2–6 topic spreads each. Write the contents list first.
3. **Research & write** content to `content.json` following §2. Cite sources.
4. **Images**: generate or source (licensed/CC0/own AI-generated). Save as PNG/JPG in `assets/`. Check resolution with Pillow: `Image.open(p).size` ≥ 1500 px on the long side for hero images. Remove backgrounds for cut-outs (e.g. `rembg`) when possible. Use a consistent style across the book (same lighting and rendering).
5. **Build**: `python scripts/build_pdf.py content.json book.pdf` (and/or `build_docx.py`). For e-book readers: the PDF is fixed-layout; for reflowable EPUB convert the same JSON to HTML (headings, paragraphs, figures) and run `pandoc book.html -o book.epub` or Calibre.
6. **QA** (see §5) by rasterising pages: `pdftoppm -jpeg -r 50 book.pdf pg` and look at them.
7. **Deliver** the file(s) plus the editable `content.json` and `assets/`.

Regional/language note: for Tamil or other Indic scripts, register a Unicode font (e.g. Noto Sans Tamil) with `pdfmetrics.registerFont(TTFont(...))` and set it as `F_BODY/F_BOLD`; Helvetica cannot render these glyphs. Bilingual layout: Tamil text in first column set, English in the next, same styles.

---

## 4. Build scripts

Install: `pip install reportlab python-docx pillow --break-system-packages`

### 4.1 `scripts/build_pdf.py` (reportlab — cover, light 3-col pages, dark pages, red header)
```python
#!/usr/bin/env python3
"""DK Visual Encyclopedia style PDF builder (reportlab).
Usage: python build_pdf.py content.json out.pdf
See SKILL.md for the content.json schema. Import-friendly: build(content, out)."""
import json, os, sys
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image,
    NextPageTemplate, PageBreak, KeepTogether, FrameBreak, Table, TableStyle)
from reportlab.lib.utils import ImageReader

# ---- design tokens (sampled from the reference) ----
RED, ORANGE, INK, GREY, PALE, DARK = (HexColor(c) for c in
    ("#DE1F4A", "#F58F0F", "#1A1A1A", "#6B6B6B", "#F3F3F3", "#0B0D14"))
PAGE_W, PAGE_H = 714, 853           # pt (~9.92 x 11.85 in), same as reference
M, GUT, BAR_H = 36, 18, 22          # outer margin, column gutter, header bar height
F_BODY, F_BOLD = "Helvetica", "Helvetica-Bold"   # swap for Source Sans 3 / Montserrat if installed

def S(name, **kw): return ParagraphStyle(name, **kw)
ST = {
 "title":  S("title", fontName=F_BOLD, fontSize=44, leading=44, textColor=INK, spaceAfter=10),
 "intro":  S("intro", fontName=F_BOLD, fontSize=11.5, leading=15, textColor=INK, spaceAfter=10),
 "h2":     S("h2", fontName=F_BOLD, fontSize=12, leading=13, textColor=INK, spaceBefore=8, spaceAfter=3),
 "body":   S("body", fontName=F_BODY, fontSize=9, leading=12.2, textColor=INK, spaceAfter=5),
 "cap_h":  S("cap_h", fontName=F_BOLD, fontSize=7.4, leading=9, textColor=INK, spaceBefore=3),
 "cap":    S("cap", fontName=F_BODY, fontSize=7.4, leading=9.2, textColor=GREY, spaceAfter=6),
 "bignum": S("bignum", fontName=F_BOLD, fontSize=34, leading=34, textColor=RED),
 "fact":   S("fact", fontName=F_BOLD, fontSize=8.5, leading=11, textColor=INK),
}
DARKST = {k: ParagraphStyle(k+"_d", parent=v, textColor=white if k not in ("cap",) else HexColor("#B8BCC8"))
          for k, v in ST.items()}

def esc(t): return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Book(BaseDocTemplate):
    def __init__(self, out, meta):
        super().__init__(out, pagesize=(PAGE_W, PAGE_H), leftMargin=M, rightMargin=M,
                         topMargin=BAR_H+M, bottomMargin=M, title=meta.get("title", ""),
                         author=meta.get("author", ""))
        self.meta, self.tag, self.topic = meta, "", ""
        cw = (PAGE_W - 2*M - 2*GUT) / 3
        top = PAGE_H - BAR_H - M; h = top - M
        def cols(n):
            w = (PAGE_W - 2*M - (n-1)*GUT) / n
            return [Frame(M+i*(w+GUT), M, w, h, id=f"c{n}_{i}", leftPadding=0, rightPadding=0,
                          topPadding=0, bottomPadding=0) for i in range(n)]
        self.addPageTemplates([
            PageTemplate("cover", [Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0,
                                         topPadding=0, bottomPadding=0)], onPage=self.cover),
            PageTemplate("light3", cols(3), onPage=self.deco(False), onPageEnd=self.head(False)),
            PageTemplate("light2", cols(2), onPage=self.deco(False), onPageEnd=self.head(False)),
            PageTemplate("dark3", cols(3), onPage=self.deco(True), onPageEnd=self.head(True)),
        ])
    def cover(self, c, d):
        c.setFillColor(INK); c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        m = self.meta
        if m.get("cover_image") and os.path.exists(m["cover_image"]):
            iw, ih = ImageReader(m["cover_image"]).getSize(); s = min(PAGE_W/iw, (PAGE_H*.7)/ih)
            c.drawImage(m["cover_image"], (PAGE_W-iw*s)/2, PAGE_H*.26, iw*s, ih*s, mask="auto")
        c.setFillColor(white); c.setFont(F_BOLD, 64); c.drawString(M, 150, m.get("title", "").upper())
        c.setFont(F_BODY, 22); c.setFillColor(HexColor("#BBBBBB")); c.drawString(M, 118, m.get("subtitle", "").upper())
        c.setFillColor(RED); c.setFont(F_BOLD, 13); c.drawString(M, 60, m.get("tagline", "").upper())
    def deco(self, dark):
        def f(c, d):
            c.saveState()
            c.setFillColor(DARK if dark else white); c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
            c.setFillColor(RED); c.rect(0, PAGE_H-6, PAGE_W, 6, fill=1, stroke=0)      # thin red top rule
            c.restoreState()
        return f
    def head(self, dark):
        def f(c, d):
            c.saveState()
            c.setFillColor(RED); c.setFont(F_BOLD, 10); c.drawString(M, PAGE_H-22, str(d.page))
            c.setFillColor(HexColor("#9A9AA5") if dark else GREY); c.setFont(F_BODY, 9)
            c.drawString(M+26, PAGE_H-22, self.tag.lower())
            c.setFillColor(white if dark else INK); c.setFont(F_BOLD, 9)
            c.drawString(M+26+c.stringWidth(self.tag.lower()+"  ", F_BODY, 9), PAGE_H-22, "◆ " + self.topic.upper())
            c.restoreState()
        return f

def img(path, width, caption_h=None, caption=None, st=ST):
    out = []
    if path and os.path.exists(path):
        iw, ih = ImageReader(path).getSize()
        out.append(Image(path, width=width, height=width*ih/iw))
    if caption_h: out.append(Paragraph(esc(caption_h), st["cap_h"]))
    if caption: out.append(Paragraph(esc(caption), st["cap"]))
    return out

def build(content, out):
    meta = content["meta"]; doc = Book(out, meta); story = []
    colw = (PAGE_W - 2*M - 2*GUT) / 3
    story = [Spacer(1, 1)]   # page 1 = cover template
    for sec in content["sections"]:
        dark = sec.get("theme") == "dark"; st = DARKST if dark else ST
        story += [NextPageTemplate("dark3" if dark else "light3"), PageBreak()]
        story.append(_Mark(sec.get("tag", ""), sec["title"], doc))
        story.append(Paragraph(esc(sec["title"]), st["title"]))
        if sec.get("intro"): story.append(Paragraph(esc(sec["intro"]), st["intro"]))
        for b in sec.get("blocks", []):
            t = b["type"]
            if t == "h2": story.append(Paragraph(esc(b["text"]), st["h2"]))
            elif t == "p": story.append(Paragraph(esc(b["text"]), st["body"]))
            elif t == "image": story.append(KeepTogether(img(b["path"], colw, b.get("caption_title"), b.get("caption"), st)))
            elif t == "fact":
                story.append(KeepTogether([Paragraph(esc(b["number"]), st["bignum"]),
                                           Paragraph(esc(b["text"]), st["fact"]), Spacer(1, 8)]))
            elif t == "colbreak": story.append(FrameBreak())
            elif t == "pagebreak": story.append(PageBreak())
    doc.build(story)

from reportlab.platypus.flowables import Flowable
class _Mark(Flowable):
    """Zero-size flowable that sets running header text for the current page."""
    def __init__(s, tag, topic, doc): super().__init__(); s.tag, s.topic, s.doc = tag, topic, doc; s.width = s.height = 0
    def wrap(s, *a): return 0, 0
    def draw(s): s.doc.tag, s.doc.topic = s.tag, s.topic

if __name__ == "__main__":
    build(json.load(open(sys.argv[1])), sys.argv[2])
```

Extend it: add `PageTemplate`s for 2-column and full-bleed image pages; draw callout leader lines with `canvas.line()` in an `onPage` hook or a custom `Flowable`; add a contents page by building twice (first pass to collect page numbers with `afterFlowable`/`notify`, second pass to render).

### 4.2 `scripts/build_docx.py` (python-docx — same JSON, 3-column sections, red rule, large cover type)
```python
#!/usr/bin/env python3
"""DK-style DOCX builder (python-docx). Usage: python build_docx.py content.json out.docx  (same JSON schema as build_pdf.py)"""
import json, sys, os
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Mm
from docx.enum.text import WD_BREAK
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

RED, INK, GREY = RGBColor(0xDE,0x1F,0x4A), RGBColor(0x1A,0x1A,0x1A), RGBColor(0x6B,0x6B,0x6B)
FONT = "Arial"   # safe everywhere; use Calibri/Source Sans if available

def run(p, text, size, bold=False, color=INK):
    r = p.add_run(text); r.font.size = Pt(size); r.bold = bold; r.font.color.rgb = color; r.font.name = FONT
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT); return r

def cols(section, n, space_pt=14):
    pr = section._sectPr; c = pr.find(qn("w:cols"))
    if c is None: c = OxmlElement("w:cols"); pr.append(c)
    c.set(qn("w:num"), str(n)); c.set(qn("w:space"), str(space_pt*20))

def red_rule(p):
    pPr = p._p.get_or_add_pPr(); b = OxmlElement("w:pBdr"); t = OxmlElement("w:top")
    for k, v in (("val","single"),("sz","24"),("space","4"),("color","DE1F4A")): t.set(qn("w:"+k), v)
    b.append(t); pPr.append(b)

def build(content, out):
    d = Document(); s = d.sections[0]
    s.page_width, s.page_height = Mm(252), Mm(301)        # ≈ reference 714x853 pt
    s.left_margin = s.right_margin = Mm(13); s.top_margin = Mm(18); s.bottom_margin = Mm(13)
    m = content["meta"]
    p = d.add_paragraph(); run(p, m.get("title","").upper(), 40, True); 
    p = d.add_paragraph(); run(p, m.get("subtitle","").upper(), 18, False, GREY)
    p = d.add_paragraph(); run(p, m.get("tagline","").upper(), 11, True, RED)
    for sec in content["sections"]:
        ns = d.add_section(); cols(ns, 1)
        p = d.add_paragraph(); red_rule(p); run(p, sec.get("tag","").lower() + "  ◆  " + sec["title"].upper(), 8, True, GREY)
        p = d.add_paragraph(); run(p, sec["title"], 34, True)
        if sec.get("intro"): p = d.add_paragraph(); run(p, sec["intro"], 11.5, True)
        ns2 = d.add_section(); cols(ns2, 3)
        for b in sec.get("blocks", []):
            t = b["type"]
            if t == "h2": run(d.add_paragraph(), b["text"], 12, True)
            elif t == "p": 
                p = d.add_paragraph(); run(p, b["text"], 9); p.paragraph_format.space_after = Pt(5)
            elif t == "image" and os.path.exists(b["path"]):
                d.add_picture(b["path"], width=Inches(2.2))
                if b.get("caption_title"): run(d.add_paragraph(), b["caption_title"], 7.5, True)
                if b.get("caption"): run(d.add_paragraph(), b["caption"], 7.5, False, GREY)
            elif t == "fact":
                run(d.add_paragraph(), b["number"], 30, True, RED); run(d.add_paragraph(), b["text"], 8.5, True)
            elif t == "pagebreak": d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    d.save(out)

if __name__ == "__main__": build(json.load(open(sys.argv[1])), sys.argv[2])
```
DOCX notes: Word cannot do true full-bleed dark pages reliably — for dark spreads use page shading (`w:background`) or embed a full-page image. After building, convert with `soffice --headless --convert-to pdf` to preview.

---

## 5. QA checklist (must pass before delivering)

- [ ] Every page has the red header, correct page number and correct section tag/topic.
- [ ] No orphan headings at column bottoms; no text overlapping images; no empty columns > 30 % of a page.
- [ ] All images sharp (≥ 150 ppi at placed size), aspect ratio preserved, captions present (bold label + grey line).
- [ ] Max 2 accent colours per page; contrast ≥ 4.5:1 (white on Night, ink on white).
- [ ] Facts verified; numbers consistent between text, captions and callouts; sources listed.
- [ ] Contents page numbers match actual pages; glossary and index present for books > 40 pages.
- [ ] Fonts embedded (`pdffonts book.pdf` shows `emb yes`); metadata title/author set.
- [ ] File size sensible (compress JPEGs to quality 85, downsample >300 ppi images).

## 6. Common mistakes to avoid
- Long paragraphs in one block → split into subheads of 40–90 words.
- Tiny or low-res images, or mixed illustration styles in one spread.
- Using many colours; stick to the palette and one section accent.
- Copying DK's actual text, photos or artwork — the skill reproduces the **style**, not the copyrighted content. Create original content and images.
- Forgetting non-Latin fonts (Tamil, Hindi, Arabic) → boxes/blank glyphs.
