"""Presentation generation: document text → a deck of layout-tagged slides.

A slide is a plain dict:

    {id, layout, title, subtitle?, bullets[], notes, alt, anim, transition, image?: {seed, style}, data?: {...}}

`layout` decides which of `data`'s shapes applies (see `_SHAPES`). The deck is produced by the configured LLM when one is
available and by the local engine (`nlp`) otherwise; both go through `_normalize`, so the frontend and the .pptx
exporter only ever see well-formed slides.
"""
from __future__ import annotations

import logging
import re
import uuid
from collections import Counter

from . import llm, nlp
from .art import THEMES

log = logging.getLogger("readvibe.deck")

LAYOUTS = (
    "title", "agenda", "concept", "bullets", "hierarchy", "types", "process", "chart", "mindmap",
    "compare", "timeline", "stats", "quote", "summary", "example",
)
CALLOUT_KINDS = ("note", "wow", "tip", "remember")  # a notation, an exclamation, a practical tip, a thing to retain
ANIMS = ("fade", "rise", "zoom", "slide", "draw")
TRANSITIONS = ("fade", "push", "zoom")
STYLES = {
    "executive": "Crisp and decision-oriented: lead with the point, keep slides sparse, quantify wherever the text allows.",
    "academic": "Rigorous and explanatory: define terms, show how ideas relate, cite the document's own claims.",
    "creative": "Vivid and story-driven: memorable framing, analogies and a clear narrative arc.",
    "technical": "Precise and structured: components, steps, categories and trade-offs; concrete over abstract.",
}
_DEFAULT_ANIM = {
    "title": "zoom", "agenda": "slide", "concept": "rise", "bullets": "rise", "hierarchy": "draw", "types": "rise",
    "process": "draw", "chart": "draw", "mindmap": "zoom", "compare": "slide", "timeline": "draw", "stats": "zoom",
    "quote": "fade", "summary": "rise", "example": "slide",
}
_IMAGE_LAYOUTS = {"title", "concept", "quote", "summary", "bullets", "example"}
_TEXT_LAYOUTS = ("concept", "bullets", "summary", "example")  # where a main point and highlighted phrases make sense


class DeckOptions:
    def __init__(self, slides: int = 12, style: str = "executive", theme: str = "aurora", images: bool = True,
                 visuals: bool = True, notes: bool = True, focus: str = ""):
        self.slides = max(5, min(30, slides))
        self.style = style if style in STYLES else "executive"
        self.theme = theme if theme in THEMES else "aurora"
        self.images, self.visuals, self.notes = images, visuals, notes
        self.focus = focus.strip()[:300]


# ─── Cleaning helpers ─────────────────────────────────────────────────────────
def _txt(v, limit: int) -> str:
    s = re.sub(r"\s+", " ", str(v or "")).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip(" ,;:.") + "…"


def _list(v, n: int, limit: int) -> list[str]:
    return [t for t in (_txt(x, limit) for x in (v if isinstance(v, list) else [])) if t][:n]


def _short(sentence: str, max_words: int = 16) -> str:
    """A slide-sized version of a sentence: parentheticals and trailing clauses go, the core stays."""
    s = re.sub(r"\s*[\(\[][^)\]]{0,80}[\)\]]", "", re.sub(r"(?m)^#+\s*", "", sentence)).strip()
    words = s.split()
    if len(words) > max_words:
        cut = " ".join(words[:max_words])
        m = re.search(r"^(.{25,}?)[,;:—–-]\s", cut)
        s = m.group(1) if m else cut
    return _txt(s.rstrip(".") if len(s.split()) > 5 else s, 120)


def _num(v) -> float | None:
    try:
        f = float(str(v).replace(",", "").rstrip("%"))
        return f if f == f and abs(f) < 1e15 else None
    except ValueError:
        return None


# ─── Normalisation: whatever produced a slide, make it well-formed ───────────
def _tree(n, depth: int = 0) -> dict | None:
    if not isinstance(n, dict):
        return None
    label = _txt(n.get("label"), 40)
    if not label:
        return None
    kids = [] if depth >= 2 else [k for k in (_tree(c, depth + 1) for c in (n.get("children") or [])[:5]) if k]
    return {"label": label, "children": kids}


def _data_for(layout: str, d) -> dict | None:
    d = d if isinstance(d, dict) else {}
    if layout == "chart":
        labels = _list(d.get("labels"), 8, 28)
        vals = [_num(x) for x in (d.get("values") or [])][: len(labels)]
        if len(labels) < 2 or len(vals) != len(labels) or any(v is None for v in vals):
            return None
        kind = d.get("kind") if d.get("kind") in ("bar", "line", "donut") else "bar"
        return {"kind": kind, "labels": labels, "values": vals, "unit": _txt(d.get("unit"), 16), "caption": _txt(d.get("caption"), 120)}
    if layout == "process":
        nodes = [{"label": _txt(n.get("label"), 36), "detail": _txt(n.get("detail"), 90)} for n in (d.get("nodes") or []) if isinstance(n, dict) and _txt(n.get("label"), 36)][:8]
        return {"nodes": nodes, "loop": bool(d.get("loop"))} if len(nodes) >= 3 else None
    if layout == "hierarchy":
        root = _tree(d.get("root"))
        return {"root": root} if root and root["children"] else None
    if layout == "mindmap":
        branches = []
        for b in (d.get("branches") or [])[:7]:
            if isinstance(b, dict) and _txt(b.get("label"), 30):
                branches.append({"label": _txt(b["label"], 30), "children": _list(b.get("children"), 4, 30)})
        return {"root": _txt(d.get("root"), 40), "branches": branches} if len(branches) >= 3 else None
    if layout in ("types", "compare"):
        cols = [{"title": _txt(c.get("title"), 34), "points": _list(c.get("points"), 5, 90)} for c in (d.get("columns") or []) if isinstance(c, dict) and _txt(c.get("title"), 34)][:4]
        return {"columns": cols} if len(cols) >= 2 else None
    if layout == "timeline":
        ev = [{"label": _txt(e.get("label"), 24), "detail": _txt(e.get("detail"), 90)} for e in (d.get("events") or []) if isinstance(e, dict) and _txt(e.get("label"), 24)][:7]
        return {"events": ev} if len(ev) >= 3 else None
    if layout == "stats":
        it = [{"value": _txt(i.get("value"), 14), "label": _txt(i.get("label"), 70)} for i in (d.get("items") or []) if isinstance(i, dict) and _txt(i.get("value"), 14)][:4]
        return {"items": it} if len(it) >= 2 else None
    if layout == "quote":
        q = _txt(d.get("text"), 220)
        return {"text": q, "source": _txt(d.get("source"), 80)} if q else None
    if layout == "example":
        t = _txt(d.get("text"), 300)
        return {"text": t, "takeaway": _txt(d.get("takeaway"), 140)} if t else None
    return {}


def _callouts(v) -> list[dict]:
    """Up to two margin notes: {kind: note|wow|tip|remember, text}. Anything else is dropped."""
    out = []
    for c in (v if isinstance(v, list) else [])[:4]:
        if isinstance(c, dict) and c.get("kind") in CALLOUT_KINDS and _txt(c.get("text"), 110):
            out.append({"kind": c["kind"], "text": _txt(c["text"], 110)})
    return out[:2]


def _highlights(v, haystack: str) -> list[str]:
    """Key phrases to emphasise: only ones that really occur in the slide's own text, so nothing is highlighted in thin air."""
    return [h for h in _list(v, 4, 40) if re.search(rf"(?<!\w){re.escape(h)}(?!\w)", haystack, re.I)][:3]


def _alt(layout: str, s: dict) -> str:
    d = s.get("data") or {}
    t = s["title"]
    if layout == "chart":
        pairs = ", ".join(f"{a} {b:g}" for a, b in zip(d["labels"], d["values"]))
        return f"{d['kind'].capitalize()} chart, {t}: {pairs}."
    if layout == "process":
        return f"Flowchart, {t}: " + " → ".join(n["label"] for n in d["nodes"]) + (", then back to the start." if d.get("loop") else ".")
    if layout == "hierarchy":
        r = d["root"]
        return f"Hierarchy, {t}: {r['label']} contains " + "; ".join(c["label"] + (f" ({', '.join(g['label'] for g in c['children'])})" if c["children"] else "") for c in r["children"]) + "."
    if layout == "mindmap":
        return f"Mind map of {d.get('root') or t}: " + "; ".join(b["label"] + (f" ({', '.join(b['children'])})" if b["children"] else "") for b in d["branches"]) + "."
    if layout in ("types", "compare"):
        return f"{'Comparison' if layout == 'compare' else 'Categories'}, {t}: " + "; ".join(c["title"] for c in d["columns"]) + "."
    if layout == "timeline":
        return f"Timeline, {t}: " + "; ".join(f"{e['label']} {e['detail']}".strip() for e in d["events"]) + "."
    if layout == "stats":
        return f"Key figures, {t}: " + "; ".join(f"{i['value']} {i['label']}" for i in d["items"]) + "."
    if layout == "quote":
        return f"Quote: {d['text']}"
    if layout == "example":
        return f"Example, {t}: {d['text']} An illustration accompanies it."
    return f"{t}. Decorative illustration."


def _normalize(raw: dict, n: int, opts: DeckOptions) -> dict | None:
    """One raw slide → a well-formed slide, or None when it has nothing usable."""
    if not isinstance(raw, dict):
        return None
    layout = raw.get("layout") if raw.get("layout") in LAYOUTS else "bullets"
    title = _txt(raw.get("title"), 90)
    if not title:
        return None
    bullets = _list(raw.get("bullets"), 7, 130)
    data = _data_for(layout, raw.get("data"))
    if data is None:  # the visual didn't survive validation: show what text there is as a plain slide
        layout, data = ("bullets" if bullets else "concept"), {}
    if layout in ("concept", "bullets", "agenda", "summary") and not bullets:
        return None
    if layout in ("chart", "process", "hierarchy", "mindmap", "types", "compare", "timeline", "stats", "quote") and not opts.visuals:
        # visuals switched off: keep the idea as text
        bullets = bullets or _flatten(layout, data)
        layout, data = "bullets", {}
    slide = {
        "id": uuid.uuid4().hex[:8], "layout": layout, "title": title, "subtitle": _txt(raw.get("subtitle"), 160),
        "bullets": bullets if layout not in ("hierarchy", "mindmap", "process", "chart", "timeline", "stats", "quote", "example") else bullets[:3],
        "notes": _txt(raw.get("notes"), 1400) if opts.notes else "",
        "anim": raw.get("anim") if raw.get("anim") in ANIMS else _DEFAULT_ANIM[layout],
        "transition": raw.get("transition") if raw.get("transition") in TRANSITIONS else TRANSITIONS[n % len(TRANSITIONS)],
        "data": data,
    }
    if layout not in ("title", "quote"):
        slide["callouts"] = _callouts(raw.get("callouts"))
    if layout in _TEXT_LAYOUTS:
        slide["main_point"] = _txt(raw.get("main_point"), 140)
        slide["highlights"] = _highlights(raw.get("highlights"), " ".join([*bullets, slide["main_point"], (data or {}).get("text", "")]))
    if opts.images and layout in _IMAGE_LAYOUTS:
        # an example gets a *scene* (a picture of what the example is about), everything else the abstract motif
        slide["image"] = {"seed": _txt(raw.get("image_prompt") or (data or {}).get("text") or title, 120), "style": "scene" if layout == "example" else ""}
    slide["alt"] = _txt(raw.get("alt"), 400) if layout in ("title", "concept", "bullets", "agenda", "summary") and raw.get("alt") else _alt(layout, slide)
    return slide


def _flatten(layout: str, d: dict) -> list[str]:
    if layout == "chart":
        return [f"{a}: {b:g}" for a, b in zip(d["labels"], d["values"])]
    if layout == "process":
        return [f"{i + 1}. {n['label']}" for i, n in enumerate(d["nodes"])]
    if layout == "hierarchy":
        return [c["label"] for c in d["root"]["children"]]
    if layout == "mindmap":
        return [b["label"] for b in d["branches"]]
    if layout in ("types", "compare"):
        return [c["title"] for c in d["columns"]]
    if layout == "timeline":
        return [f"{e['label']} — {e['detail']}" for e in d["events"]]
    if layout == "stats":
        return [f"{i['value']} {i['label']}" for i in d["items"]]
    if layout == "quote":
        return [d["text"]]
    return []


# ─── LLM path ─────────────────────────────────────────────────────────────────
_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "slides": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "layout": {"type": "string", "enum": list(LAYOUTS)},
                    "title": {"type": "string"},
                    "subtitle": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                    "notes": {"type": "string"},
                    "alt": {"type": "string"},
                    "anim": {"type": "string", "enum": list(ANIMS)},
                    "image_prompt": {"type": "string"},
                    "main_point": {"type": "string"},
                    "highlights": {"type": "array", "items": {"type": "string"}},
                    "callouts": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"kind": {"type": "string", "enum": list(CALLOUT_KINDS)}, "text": {"type": "string"}}, "required": ["kind", "text"]},
                    },
                    "data": {"type": "object"},
                },
                "required": ["layout", "title"],
            },
        },
    },
    "required": ["title", "slides"],
}

_DATA_GUIDE = """\
`data` by layout (omit for title/agenda/concept/bullets/summary):
- chart:     {"kind":"bar|line|donut","labels":[..],"values":[numbers],"unit":"%","caption":"…"}  — only numbers that appear in, or are directly countable from, the text
- process:   {"nodes":[{"label":"≤5 words","detail":"one line"}],"loop":false}  — 3-7 ordered steps
- hierarchy: {"root":{"label":"…","children":[{"label":"…","children":[{"label":"…"}]}]}}  — 2-3 levels
- mindmap:   {"root":"central idea","branches":[{"label":"…","children":["…","…"]}]}  — 4-6 branches
- types:     {"columns":[{"title":"Type name","points":["…"]}]}  — 2-4 categories/kinds
- compare:   {"columns":[{"title":"A","points":["…"]},{"title":"B","points":["…"]}]}
- timeline:  {"events":[{"label":"1998","detail":"…"}]}  — 3-6 events in order
- stats:     {"items":[{"value":"42%","label":"what it measures"}]}  — 2-4 figures quoted from the text
- quote:     {"text":"a striking line from the document","source":"who/where"}
- example:   {"text":"a concrete example from the document, 1-3 sentences","takeaway":"what it shows, ≤14 words"}  — gets its own generated illustration"""


def _source_text(sections: list[tuple[int, str, str]], budget_words: int = 7000) -> str:
    per = max(250, budget_words // max(1, len(sections)))
    parts = []
    for _, title, text in sections:
        ws = text.split()
        parts.append(f"## {title}\n{' '.join(ws[:per])}{' …' if len(ws) > per else ''}")
    return "\n\n".join(parts)


def _llm_deck(title: str, sections: list[tuple[int, str, str]], opts: DeckOptions) -> dict:
    prompt = (
        f"Turn the document “{title}” into a {opts.slides}-slide presentation that EXPLAINS its topics and concepts to an audience "
        f"(do not merely list headings). Style: {STYLES[opts.style]}\n"
        + (f"Focus: {opts.focus}\n" if opts.focus else "")
        + "\nRules:\n"
        f"- Exactly {opts.slides} slides (±1). Slide 1 layout 'title'; the last is 'summary'. Include an 'agenda' near the start when there are 4+ topics.\n"
        "- Teach with variety: use 'concept' slides (a short definition + 2-4 bullets) for ideas, and choose a VISUAL layout wherever the content has that shape: "
        "hierarchy for parent/child structure, types for kinds/categories, process for sequences, chart for quantities, mindmap for how ideas connect, "
        "compare for two things side by side, timeline for dates, stats for key figures.\n"
        + ("- Visual layouts are disabled: use only title, agenda, concept, bullets, quote and summary.\n" if not opts.visuals else "")
        + "- Bullets: at most 4 per slide, at most 14 words each, no trailing periods. Titles: at most 8 words and say something (a claim, not a label).\n"
        + ("- `notes`: a 2-4 sentence speaker script in a natural spoken voice, with a transition into the next slide.\n" if opts.notes else "- `notes`: leave empty.\n")
        + "- Explain with EXAMPLES: after a concept slide whose document text gives a concrete example, add an 'example' slide for it (at most 3-4 per deck); "
        "its `image_prompt` names the thing the example is about (e.g. 'team collaborating', 'password protecting data') so the illustration fits.\n"
        "- Mark what matters on concept/bullets/summary/example slides: `main_point` (one sentence, ≤16 words: the single thing to remember), `highlights` "
        "(1-3 short phrases copied EXACTLY from this slide's bullets), and `callouts` (0-2 margin notes: kind 'note' for a definition or clarification, "
        "'wow' for a surprising fact stated with an exclamation, 'tip' for practical advice, 'remember' for a key point; ≤16 words each, from the document only).\n"
        "- `alt`: one sentence describing the slide's visual for a screen-reader user.\n"
        "- `image_prompt`: 3-6 words naming the scene for the slide's generated illustration.\n"
        "- `anim`: the entrance motion that suits the slide (fade, rise, zoom, slide, draw — draw for diagrams and charts).\n"
        "- Use only facts from the document. Never invent numbers.\n\n"
        + _DATA_GUIDE
        + f"\n\n<document>\n{_source_text(sections)}\n</document>"
    )
    data = llm.complete_json(llm.READER_SYSTEM, prompt, _SCHEMA, max_tokens=9000)
    slides = [s for s in (_normalize(r, i, opts) for i, r in enumerate(data["slides"])) if s]
    if len(slides) < 3:
        raise llm.LLMUnavailable("the model returned too few usable slides")
    return {"title": _txt(data.get("title") or title, 120), "subtitle": _txt(data.get("subtitle"), 200), "slides": slides}


# ─── Local engine ─────────────────────────────────────────────────────────────
def _topics(title: str, sections: list[tuple[int, str, str]], mm: dict) -> list[tuple[str, str]]:
    """(heading, text) per topic: the document's own sections, or — for one long section — the mind map's branches."""
    if len(sections) > 1:
        return [(t, x) for _, t, x in sections]
    text = sections[0][2]
    sents = nlp.sentences(text)
    out = []
    for br in mm["root"]["children"]:
        key = br["label"].lower()
        hit = [s for s in sents if key in s.lower()] or nlp.top_sentences(text, 3, br["label"])
        out.append((br["label"], " ".join(hit[:5])))
    return out


def _years(text: str) -> list[tuple[int, str]]:
    seen, out = set(), []
    for s in nlp.sentences(text):
        m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", s)
        if m and int(m.group(1)) not in seen:
            seen.add(int(m.group(1)))
            out.append((int(m.group(1)), s))
    return sorted(out)


_FIGURE = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s?(%|percent|per cent|million|billion|trillion|thousand)\b", re.I)


def _figures(text: str) -> list[dict]:
    out, seen = [], set()
    for s in nlp.sentences(text):
        m = _FIGURE.search(s)
        if not m:
            continue
        unit = m.group(2).lower()
        val = f"{m.group(1)}{'%' if unit in ('%', 'percent', 'per cent') else ' ' + unit}"
        if val in seen:
            continue
        seen.add(val)
        out.append({"value": val, "label": _short(s, 12)})
    return out


_DEF = re.compile(r"\b(?:is|are|was|were)\s+(?:defined as|called|known as|referred to as|termed)\b|\bmeans\b|\brefers? to\b|\bstands? for\b", re.I)
_WOW = re.compile(r"\b(?:surpris\w+|remarkabl\w+|astonish\w+|incredibl\w+|dramatic\w*|huge|enormous|largest|smallest|fastest|million|billion)\b", re.I)
_MUST = re.compile(r"\b(?:should|must|always|never|remember|important|essential|crucial|need to)\b", re.I)
_TIP = re.compile(r"\b(?:try|use|avoid|make sure|ensure|consider)\b", re.I)
_EXAMPLE = re.compile(r"\b(?:for example|for instance|such as|e\.g\.|imagine|suppose|consider)\b", re.I)


def _enrich(head: str, text: str, bullets: list[str]) -> dict:
    """Main point, highlighted phrases, margin notes (notation / exclamation / tip) and an example sentence for one topic,
    all taken from the topic text itself."""
    sents = nlp.sentences(text)
    used: set[str] = set()

    def pick(rx, exclude=()):
        for x in sents:
            if x not in used and x not in exclude and rx.search(x) and 5 <= len(x.split()) <= 40:
                used.add(x)
                return x
        return None

    callouts = []
    d = pick(_DEF)
    if d:
        callouts.append({"kind": "note", "text": _short(d, 18)})
    w = next((x for x in sents if x not in used and x.rstrip().endswith("!") and 3 <= len(x.split()) <= 30), None) or pick(_WOW)
    if w:
        used.add(w)
        callouts.append({"kind": "wow", "text": _short(w, 16).rstrip(".!") + "!"})
    if len(callouts) < 2:
        m = pick(_MUST)
        if m:
            callouts.append({"kind": "remember", "text": _short(m, 16)})
    if len(callouts) < 2:
        t = pick(_TIP)
        if t:
            callouts.append({"kind": "tip", "text": _short(t, 16)})

    shown = [c["text"].lower().rstrip("!.") for c in callouts]
    top = [t for t in nlp.top_sentences(text, 4) if not any(_short(t, 16).lower().rstrip("!.") in c or c in _short(t, 16).lower() for c in shown)]
    main = _short(top[0], 16) if top else ""  # the main point is never the sentence a margin note already repeats
    joined = " ".join(bullets)
    highlights = []
    for ph in nlp.key_phrases(text, 6):
        m = re.search(rf"(?<!\w){re.escape(ph)}(?!\w)", joined, re.I)  # whole words only: "design" is not picked out of "designers"
        if m:
            highlights.append(m.group(0))
    ex = [x for x in sents if _EXAMPLE.search(x) and 6 <= len(x.split()) <= 45]
    example = _txt(" ".join(ex[:2]), 300) if ex else ""
    return {"callouts": callouts[:2], "main_point": main, "highlights": highlights[:3], "example": example}


def _local_deck(title: str, sections: list[tuple[int, str, str]], opts: DeckOptions) -> dict:
    full = "\n\n".join(t for _, _, t in sections)
    words = len(full.split())
    corpus = [t for _, _, t in sections]
    mm = nlp.mind_map(title, [(i, t, x) for i, t, x in sections])
    topics = _topics(title, sections, mm)[:14]
    branches = mm["root"]["children"]
    summ = nlp.summarize(full, title, "standard", corpus)
    key_points = [_short(s) for s in nlp.top_sentences(full, 6)]  # takeaways
    phrases = nlp.key_phrases(full, 10, corpus)

    def notes(head: str, text: str, nxt: str | None) -> str:
        body = " ".join(nlp.top_sentences(text, 3)) or head
        return f"{head}. {body}" + (f" With that in mind, let's move on to {nxt}." if nxt else "")

    core: list[dict] = []
    for i, (head, text) in enumerate(topics):
        pts = [_short(s) for s in nlp.top_sentences(text, 4)] or [_short(head)]
        extra = _enrich(head, text, pts)
        if extra["main_point"] and len(pts) > 2:  # the key point is shown in its own band, so it is not repeated as a bullet
            norm = extra["main_point"].lower().rstrip(".!")
            pts = [p for p in pts if p.lower().rstrip(".!") != norm]
        core.append({
            "layout": "concept", "title": _txt(head, 80), "bullets": pts,
            "notes": notes(head, text, topics[i + 1][0] if i + 1 < len(topics) else None), "image_prompt": head,
            "main_point": extra["main_point"], "highlights": extra["highlights"], "callouts": extra["callouts"],
        })
        if extra["example"] and sum(1 for c in core if c["layout"] == "example") < 4:  # an example, with a picture of what it is about
            core.append({
                "layout": "example", "title": _txt(f"In practice: {head}", 80), "data": {"text": extra["example"], "takeaway": extra["main_point"]},
                "notes": f"Here is an example. {extra['example']}", "image_prompt": extra["example"],
                "main_point": extra["main_point"], "callouts": [],
            })

    visuals: list[dict] = []
    if len(branches) >= 3:
        visuals.append({"layout": "mindmap", "title": "How the ideas connect", "data": {
            "root": _txt(title, 40), "branches": [{"label": b["label"], "children": [c["label"] for c in b["children"][:3]]} for b in branches[:6]]},
            "notes": f"This map shows how {title} breaks into its main branches: " + ", ".join(b["label"] for b in branches[:5]) + "."})
        visuals.append({"layout": "hierarchy", "title": "The structure at a glance", "data": {"root": {
            "label": _txt(title, 40), "children": [{"label": b["label"], "children": [{"label": c["label"]} for c in b["children"][:3]]} for b in branches[:5]]}},
            "notes": "Read this top-down: the main topic, its major parts, and the ideas that sit under each part."})
        cols = [{"title": b["label"], "points": [c.get("detail") and _short(c["detail"], 12) or c["label"] for c in b["children"][:3]]} for b in branches[:4]]
        if all(c["points"] for c in cols):
            visuals.append({"layout": "types", "title": "The main categories", "data": {"columns": cols},
                            "notes": "Here are the main categories and what characterises each one."})
    steps = nlp.diagram(full, title, "flowchart", "LR", "standard")["nodes"][1:]
    if len(steps) >= 3 and re.search(r"\b(first|then|next|finally|step|stage|phase|process)\b", full, re.I):
        visuals.append({"layout": "process", "title": "How it works, step by step", "data": {
            "nodes": [{"label": s["label"], "detail": ""} for s in steps[:7]], "loop": bool(re.search(r"\b(cycle|loop|repeat|iterat)", full, re.I))},
            "notes": "Walk through the sequence in order; each step feeds the next."})
    if phrases:
        counts = [(p, max(1, full.lower().count(p.lower()))) for p in phrases[:7]]
        visuals.append({"layout": "chart", "title": "The ideas that come up most", "data": {
            "kind": "bar", "labels": [p for p, _ in counts], "values": [c for _, c in counts], "unit": "mentions",
            "caption": "How often each key idea appears in the document"},
            "notes": "Frequency is a quick proxy for emphasis: the longer the bar, the more the document returns to that idea."})
    if len(sections) >= 3:
        visuals.append({"layout": "chart", "title": "Where the document spends its time", "data": {
            "kind": "donut", "labels": [_txt(t, 24) for _, t, _ in sections[:7]], "values": [len(x.split()) for _, _, x in sections[:7]], "unit": "words",
            "caption": "Share of the text in each section"}, "notes": "This split shows which sections carry the most weight."})
    figs = _figures(full)
    if len(figs) >= 2:
        visuals.append({"layout": "stats", "title": "Figures worth remembering", "data": {"items": figs[:4]},
                        "notes": "A few numbers from the document that anchor the argument."})
    yrs = _years(full)
    if len(yrs) >= 3:
        pick = yrs[:7]
        visuals.append({"layout": "timeline", "title": "A timeline of key moments", "data": {"events": [{"label": str(y), "detail": _short(s, 12)} for y, s in pick]},
                        "notes": "Follow the dates left to right to see how events unfold."})

    # when the deck is short, the most explanatory visuals survive first: mind map, chart, flowchart, structure, figures, dates
    rank = {"mindmap": 0, "chart": 1, "process": 2, "hierarchy": 3, "stats": 4, "timeline": 5, "types": 6}
    visuals.sort(key=lambda v: rank.get(v["layout"], 9))  # stable: the keyword chart stays ahead of the section-share chart

    # interleave: agenda · concept · concept · visual · concept · concept · visual …
    body: list[dict] = []
    ci, vi = 0, 0
    while ci < len(core) or vi < len(visuals):
        for _ in range(2):
            if ci < len(core):
                body.append(core[ci]); ci += 1
        if vi < len(visuals):
            body.append(visuals[vi]); vi += 1
    quote = next((s for s in nlp.top_sentences(full, 8) if 8 <= len(s.split()) <= 26), None)

    head: list[dict] = [{
        "layout": "title", "title": _txt(title, 90), "subtitle": f"{len(sections)} {'sections' if len(sections) != 1 else 'section'} · {max(1, round(words / 220))} min read",
        "notes": f"Welcome. Today we're looking at {title}. " + _short(summ["main_idea"], 28), "image_prompt": title,
    }]
    if len(topics) >= 3:
        head.append({"layout": "agenda", "title": "What we'll cover", "bullets": [_txt(t, 60) for t, _ in topics[:7]],
                     "notes": "Here is the road map for the next few minutes."})
    tail: list[dict] = []
    if quote:
        tail.append({"layout": "quote", "title": "The idea in one line", "data": {"text": quote, "source": title}, "notes": "If you remember one thing, remember this.", "image_prompt": "key idea"})
    tail.append({"layout": "summary", "title": "Key takeaways", "bullets": key_points[:5] or [_short(title)],
                 "notes": "To close, here are the points to take with you. Thank you — happy to take questions.", "image_prompt": "conclusion horizon"})

    room = max(0, opts.slides - len(head) - len(tail))
    plan = head + body[:room] + tail
    if not opts.visuals:
        plan = [p for p in plan if p["layout"] in ("title", "agenda", "concept", "summary", "quote")]
    slides = [s for s in (_normalize(p, i, opts) for i, p in enumerate(plan)) if s]
    return {"title": _txt(title, 120), "subtitle": slides[0]["subtitle"] if slides else "", "slides": slides}


# ─── Public API ───────────────────────────────────────────────────────────────
def build(title: str, sections: list[tuple[int, str, str]], opts: DeckOptions) -> dict:
    """→ {title, subtitle, slides, engine}. Falls back to the local engine whenever the LLM is down or its reply is unusable."""
    sections = [(i, t, x) for i, t, x in sections if x and x.strip()]
    if not sections:
        raise ValueError("There is no text to build a presentation from")
    if llm.available():
        try:
            return {**_llm_deck(title, sections, opts), "engine": llm.provider_name()}
        except (llm.LLMUnavailable, ValueError, KeyError, TypeError) as exc:
            log.info("deck fallback to local engine: %s", exc)
    return {**_local_deck(title, sections, opts), "engine": "local"}


def clean_slides(slides: list, opts: DeckOptions | None = None) -> list[dict]:
    """Re-validate slides coming back from the editor so a saved deck can never hold a malformed one."""
    opts = opts or DeckOptions(images=True, visuals=True, notes=True)
    out = []
    for i, raw in enumerate(slides):
        s = _normalize(raw, i, opts)
        if s:
            s["id"] = _txt(raw.get("id"), 16) or s["id"]
            if isinstance(raw.get("image"), dict) and "image" in s:
                s["image"] = {"seed": _txt(raw["image"].get("seed"), 120) or s["image"]["seed"], "style": raw["image"].get("style") if raw["image"].get("style") in ("orbit", "network", "wave", "crystal", "scene") else ""}
            out.append(s)
    return out


def word_counts(text: str) -> Counter:
    return Counter(nlp.content_words(text))
