"""AI feature orchestration: uses the free LLM when it answers, the local engine otherwise.

Both paths return the same JSON shapes so the frontend never needs to care which ran.
"""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict

from ..models import Document
from . import llm, nlp

log = logging.getLogger("readvibe.ai")

_MAX_CONTEXT_WORDS = 9000


# ─── Small thread-safe LRU cache for expensive, deterministic results ────────
class _LRU:
    def __init__(self, size: int = 256):
        self.size = size
        self.data: OrderedDict = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]
        return None

    def set(self, key, value):
        with self.lock:
            self.data[key] = value
            self.data.move_to_end(key)
            while len(self.data) > self.size:
                self.data.popitem(last=False)


_cache = _LRU()
_index_cache = _LRU(64)


def _scope(doc: Document, chapter_index: int | None) -> tuple[str, str, list[tuple[int, str, str]]]:
    chapters = [(c.position, c.title, c.content) for c in doc.chapters]
    if chapter_index is not None and 0 <= chapter_index < len(chapters):
        ch = chapters[chapter_index]
        return ch[1], ch[2], [ch]
    return doc.title, "\n\n".join(c[2] for c in chapters), chapters


def _cache_key(doc: Document, *parts) -> tuple:
    return (doc.id, doc.updated_at.isoformat() if doc.updated_at else "", llm.available(), *parts)


GROQ_CONTEXT_WORDS = 2400  # ~3.3k tokens: what fits a free-tier Groq minute together with a useful reply


def _budget() -> int:
    return GROQ_CONTEXT_WORDS if llm.groq_enabled() else _MAX_CONTEXT_WORDS


def _trim(text: str, max_words: int | None = None) -> str:
    max_words = min(max_words or _MAX_CONTEXT_WORDS, _budget())
    ws = text.split()
    return text if len(ws) <= max_words else " ".join(ws[:max_words]) + " …"


def _index(doc: Document) -> nlp.BM25Index:
    key = _cache_key(doc, "bm25")
    idx = _index_cache.get(key)
    if idx is None:
        idx = nlp.BM25Index(nlp.build_passages([(c.position, c.title, c.content) for c in doc.chapters]))
        _index_cache.set(key, idx)
    return idx


def _context_for(doc: Document, chapter_index: int | None, query: str) -> str:
    """Whole chapter if it fits, otherwise the most relevant passages from the document."""
    title, text, _ = _scope(doc, chapter_index)
    if len(text.split()) <= _MAX_CONTEXT_WORDS:
        return text
    hits = _index(doc).search(query or title, 24)
    return "\n\n".join(f"[{p.chapter_title}] {p.text}" for _, p in hits) or _trim(text)


def _with_engine(result: dict, engine: str) -> dict:
    result["engine"] = engine
    return result


# ─── Summaries ────────────────────────────────────────────────────────────────
_SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "main_idea": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "concepts": {"type": "array", "items": {"type": "string"}},
        "examples": {"type": "array", "items": {"type": "string"}},
        "takeaways": {"type": "string"},
        "suggested_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["main_idea", "key_points"],  # the rest is filled in by _normalize_summary when a model leaves it out
    "additionalProperties": False,
}


# What each depth IS. They are three different documents, not one document with different counts: a glance, an explanation, a study guide.
_DEPTH_SPEC = {
    "brief": {
        "label": "BRIEF — a glance",
        "style": (
            "Write a TL;DR for someone with 60 seconds. `main_idea`: ONE sentence of at most 28 words that states the whole point. "
            "`key_points`: exactly 3 items, each a single crisp sentence of at most 16 words — facts and claims only, no background. "
            "`concepts`: exactly 3 bare terms (1-3 words each), no definitions. `examples`: an empty list. "
            "`takeaways`: one short sentence the reader should remember. `suggested_questions`: 2 questions. "
            "Cut everything that is not essential; do not explain, do not give context."
        ),
        "tokens": 1500,
        "temperature": 0.5,
    },
    "standard": {
        "label": "STANDARD — an explanation",
        "style": (
            "Explain the material to an interested reader who has not read it. `main_idea`: a short paragraph of 3-4 sentences covering what the text "
            "argues and why. `key_points`: 5-7 items, each 1-2 sentences that state the point AND the reason or consequence behind it. "
            "`concepts`: 5-8 terms, each formatted exactly as 'Term — one-line meaning'. `examples`: 2-3 concrete examples or moments from the text, "
            "each in one or two sentences. `takeaways`: 2-3 sentences. `suggested_questions`: 3 questions. Keep the order in which the text develops."
        ),
        "tokens": 3500,
        "temperature": 0.6,
    },
    "deep": {
        "label": "DEEP DIVE — a study guide",
        "style": (
            "Write a thorough study guide for someone who must master this material and be examined on it. `main_idea`: a full paragraph of 5-7 sentences "
            "giving the thesis, the context, the structure of the argument and where it leads. `outline`: 5-9 sections in reading order, each with a "
            "`heading` and a `summary` of 2-3 sentences describing what happens or is argued there. `key_points`: 9-12 items, each 2-3 sentences with the "
            "claim, the supporting evidence or detail from the text, and its implication. `concepts`: 8-12 terms, each formatted exactly as "
            "'Term — definition, and the role it plays in the text' (1-2 sentences). `examples`: 3-5 passages, cases or details from the text with "
            "enough context to be understood alone; quote short phrases where useful. `takeaways`: a paragraph of 3-4 sentences on what to remember, "
            "what is open to debate and how the ideas connect. `suggested_questions`: 5 exam-style questions that need reasoning, not recall."
        ),
        "tokens": 7500,
        "temperature": 0.7,
    },
}

_OUTLINE_SCHEMA = {
    "type": "array",
    "items": {"type": "object", "properties": {"heading": {"type": "string"}, "summary": {"type": "string"}}, "required": ["heading", "summary"]},
}


def _as_text(x) -> str:
    """Models sometimes hand back {"point": "...", "detail": "..."} where a string was asked for: flatten it to readable text."""
    if isinstance(x, str):
        return x.strip()
    if isinstance(x, dict):
        vals = [str(v).strip() for v in x.values() if isinstance(v, (str, int, float)) and str(v).strip()]
        return " — ".join(vals[:2]) if len(vals) == 2 and len(vals[0]) < 60 else " ".join(vals)
    if isinstance(x, (list, tuple)):
        return " ".join(_as_text(i) for i in x)
    return str(x or "").strip()


_SUMMARY_LIMITS = {  # depth -> (key_points, concepts, examples, questions, outline)
    "brief": (3, 3, 0, 2, 0),
    "standard": (8, 8, 3, 4, 0),
    "deep": (12, 12, 5, 6, 9),
}


def _normalize_summary(data: dict, depth: str) -> dict:
    """Whatever the model sent, return the shape the app renders: lists of plain strings, within the limits of the chosen depth."""
    kp, co, ex, qu, ol = _SUMMARY_LIMITS[depth]
    clean = lambda items, n: [t for t in (_as_text(i) for i in (items or [])) if t][:n]  # noqa: E731
    data["main_idea"] = _as_text(data.get("main_idea"))
    data["takeaways"] = _as_text(data.get("takeaways"))
    data["key_points"] = clean(data.get("key_points"), kp)
    data["concepts"] = clean(data.get("concepts"), co)
    data["examples"] = clean(data.get("examples"), ex)
    data["suggested_questions"] = clean(data.get("suggested_questions"), qu)
    outline = []
    for o in (data.get("outline") or [])[:ol]:
        if isinstance(o, dict):
            heading = _as_text(o.get("heading") or o.get("title") or o.get("section"))
            summary = _as_text(o.get("summary") or o.get("description") or o.get("text"))
        else:
            heading, summary = "", _as_text(o)
        if heading or summary:
            outline.append({"heading": heading or f"Part {len(outline) + 1}", "summary": summary})
    if ol:
        data["outline"] = outline
    else:
        data.pop("outline", None)
    if not data["main_idea"] or not data["key_points"]:
        raise ValueError("summary came back empty")
    if depth != "brief" and not data["concepts"]:
        raise ValueError("summary left out the concepts")
    if depth == "deep" and not data.get("outline"):
        raise ValueError("deep summary left out the outline")
    return data


def _spread(chapters: list[tuple[int, str, str]], max_words: int) -> str:
    """Several chapters, one budget: a fair share from the start of each, so a long book is summarised from all of it, not just chapter one."""
    total = sum(len(c[2].split()) for c in chapters)
    if total <= max_words:
        return "\n\n".join(f"## {c[1]}\n{c[2]}" for c in chapters)
    share = max(60, max_words // max(1, len(chapters)))
    return "\n\n".join(f"## {c[1]}\n{' '.join(c[2].split()[:share])}" for c in chapters)


def summarize(doc: Document, chapter_index: int | None, depth: str) -> dict:
    title, text, chapters = _scope(doc, chapter_index)
    # AI summaries are never served from the cache: pressing Regenerate must write a fresh one. Only the deterministic local fallback is cached.
    key = _cache_key(doc, "summary", chapter_index, depth)
    if not llm.available() and (hit := _cache.get(key)) is not None:
        return hit
    corpus = [c.content for c in doc.chapters]
    result = None
    if llm.available():
        spec = _DEPTH_SPEC[depth]
        schema = {**_SUMMARY_SCHEMA, "properties": dict(_SUMMARY_SCHEMA["properties"])}
        if depth == "deep":
            schema["properties"]["outline"] = _OUTLINE_SCHEMA
        try:
            data = llm.complete_json(
                f"{llm.READER_SYSTEM} You are writing the {spec['label']} version of a summary; the reader chose this depth on purpose, "
                "so obey the length and shape rules exactly and never pad a short version or squeeze a long one.",
                f"Summarise “{title}” from the document “{doc.title}” by {doc.author}.\n\nDEPTH RULES:\n{spec['style']}\n\n"
                "Everything must come from the text. Do not repeat the same sentence across fields. Write fresh wording.\n\n"
                f"<document>\n{_trim(_spread(chapters, _budget()) if len(chapters) > 1 else text)}\n</document>",
                schema,
                max_tokens=spec["tokens"],
                temperature=spec["temperature"],
            )
            data = _normalize_summary(data, depth)
            data["depth"] = depth
            data["reading_time_saved_min"] = max(1, round(len(text.split()) / 230) - 1)
            result = _with_engine(data, llm.provider_name())
        except (llm.LLMUnavailable, ValueError) as exc:
            log.info("summary fallback: %s", exc)
    if result is None:
        result = _with_engine(nlp.summarize(text, title, depth, corpus), "local")
        result["scope"] = {"title": title, "chapter_index": chapter_index, "chapters": len(chapters)}
        _cache.set(key, result)
        return result
    result["scope"] = {"title": title, "chapter_index": chapter_index, "chapters": len(chapters)}
    return result


# ─── Explain / define / compare ───────────────────────────────────────────────
_EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {
        "explanation": {"type": "string"},
        "key_terms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"term": {"type": "string"}, "definition": {"type": "string"}},
                "required": ["term", "definition"],
                "additionalProperties": False,
            },
        },
        "related_passages": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["explanation", "key_terms", "related_passages"],
    "additionalProperties": False,
}

_MODE_GUIDE = {
    "simple": "Explain it in plain language a 12-year-old could follow, in 2-4 sentences.",
    "student": "Explain it like a good tutor to a university student: the idea, why it matters, and how to remember it.",
    "expert": "Give an expert-level explanation: precise terminology, underlying assumptions, and connections to the wider argument.",
    "example": "Explain it through one concrete, everyday example, preferably one the text itself uses.",
    "analogy": "Explain it with a vivid real-world analogy, then map the analogy back to the passage.",
}


def explain(selection: str, mode: str, doc: Document | None) -> dict:
    context = ""
    if doc is not None:
        hits = _index(doc).search(selection, 6)
        context = "\n\n".join(p.text for _, p in hits)
    if llm.available():
        try:
            data = llm.complete_json(
                llm.READER_SYSTEM,
                f"{_MODE_GUIDE[mode]}\n\nPassage to explain:\n<selection>\n{selection}\n</selection>\n\n"
                + (f"Surrounding context from “{doc.title}”:\n<context>\n{_trim(context, 2500)}\n</context>\n\n" if context else "")
                + "List up to 3 key terms with short definitions, and up to 2 short related passages quoted from the context.",
                _EXPLAIN_SCHEMA,
                max_tokens=3000,
            )
            data["mode"] = mode
            return _with_engine(data, llm.provider_name())
        except llm.LLMUnavailable as exc:
            log.info("explain fallback: %s", exc)
    full = "\n\n".join(c.content for c in doc.chapters) if doc else ""
    return nlp.explain(selection, mode, full or context)


def define_in_document(term: str, doc: Document | None) -> list[str]:
    if doc is None:
        return []
    return nlp.find_definitions(term, "\n\n".join(c.content for c in doc.chapters), 3)


def compare(doc: Document, chapter_index: int | None, a: str, b: str) -> dict:
    _, text, _ = _scope(doc, chapter_index)
    if chapter_index is not None and (a.lower() not in text.lower() or b.lower() not in text.lower()):
        text = "\n\n".join(c.content for c in doc.chapters)  # widen scope when the chapter lacks a concept
    result = nlp.compare(text, a, b)
    if llm.available():
        try:
            evidence = "\n".join(result["a"]["evidence"] + result["b"]["evidence"] + result["connection"])
            result["summary"] = llm.complete_text(
                llm.READER_SYSTEM,
                [{"role": "user", "content": f"Using only this evidence from “{doc.title}”, compare “{a}” and “{b}” "
                                             f"in one short paragraph.\n<evidence>\n{evidence or 'No evidence found.'}\n</evidence>"}],
                max_tokens=1500,
            )
            return _with_engine(result, llm.provider_name())
        except llm.LLMUnavailable:
            pass
    return _with_engine(result, "local")


# ─── Chat with the book ───────────────────────────────────────────────────────
def chat(doc: Document, chapter_index: int | None, question: str, history: list[dict], selection: str | None) -> dict:
    idx = _index(doc)
    query = f"{question} {selection or ''}"
    hits = idx.search(query, 6)
    answer_index = idx
    if chapter_index is not None:
        scoped = [h for h in idx.search(query, 40) if h[1].chapter_index == chapter_index]
        if scoped:  # answer from the chosen chapter; fall back to the whole book if it says nothing
            hits = scoped[:6]
            answer_index = nlp.BM25Index([p for p in idx.passages if p.chapter_index == chapter_index])
    local = nlp.answer_question(query, answer_index)
    if llm.available():
        excerpts = "\n\n".join(f"<excerpt chapter=\"{p.chapter_title}\">\n{p.text}\n</excerpt>" for _, p in hits)
        if not excerpts:  # a generic question ("what is the main idea?") matches no keywords: give the model the opening instead
            title, text, _ = _scope(doc, chapter_index)
            excerpts = f"<excerpt chapter=\"{title}\">\n{_trim(text, 1200)}\n</excerpt>"
        messages = [{"role": t["role"], "content": t["content"]} for t in history[-8:] if t.get("content")]
        # The Messages API requires the first message to be from the user.
        while messages and messages[0]["role"] != "user":
            messages.pop(0)
        prompt = (
            f"Document: “{doc.title}” by {doc.author}.\n"
            + (f"The reader selected this text: “{selection}”.\n" if selection else "")
            + f"Relevant excerpts:\n{excerpts or 'No closely matching excerpts were found.'}\n\nQuestion: {question}"
        )
        if messages and messages[-1]["role"] == "user":
            messages[-1] = {"role": "user", "content": messages[-1]["content"] + "\n\n" + prompt}
        else:
            messages.append({"role": "user", "content": prompt})
        try:
            answer = llm.complete_text(llm.READER_SYSTEM, messages, max_tokens=3000)
            return {**local, "answer": answer, "engine": llm.provider_name()}
        except llm.LLMUnavailable as exc:
            log.info("chat fallback: %s", exc)
    return {**local, "engine": "local"}


# ─── Visual learning: mind maps & diagrams ────────────────────────────────────
def mind_map(doc: Document, chapter_index: int | None) -> dict:
    key = _cache_key(doc, "mindmap", chapter_index)
    if (hit := _cache.get(key)) is not None:
        return hit
    title, scope_text, chapters = _scope(doc, chapter_index)
    result = None
    if llm.available():
        try:
            data = llm.complete_json(
                llm.READER_SYSTEM,
                f"Build a mind map of “{title}” for a reader.\n\n<text>\n{_trim(scope_text, 4500)}\n</text>\n\n"
                "Give 4-7 main branches (the big ideas, in the order the text develops them), each with a one-sentence `detail` taken from the "
                "text and 2-4 sub-points (short labels of at most 5 words, each with its own one-sentence `detail`). Use only what the text says.",
                _MINDMAP_SCHEMA,
                max_tokens=3500,
            )
            only = chapter_index if chapter_index is not None else None
            root = {"id": "root", "label": title, "children": []}
            for i, b in enumerate(data["branches"][:8]):
                node = {"id": f"k{i}", "label": str(b.get("label", ""))[:80], "detail": b.get("detail") or None, "chapter_index": only, "children": []}
                for j, c in enumerate((b.get("children") or [])[:5]):
                    node["children"].append({"id": f"k{i}-{j}", "label": str(c.get("label", ""))[:80], "detail": c.get("detail") or None, "chapter_index": only, "children": []})
                if node["label"]:
                    root["children"].append(node)
            if len(root["children"]) >= 2:
                result = _with_engine({"root": root}, llm.provider_name())
        except (llm.LLMUnavailable, KeyError, TypeError, AttributeError) as exc:
            log.info("mind map fallback: %s", exc)
    if result is None:
        result = _with_engine(nlp.mind_map(title, chapters), "local")
    _cache.set(key, result)
    return result


_MINDMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "branches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "detail": {"type": "string"},
                    "children": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "detail": {"type": "string"}}, "required": ["label"]}},
                },
                "required": ["label", "children"],
            },
        },
    },
    "required": ["branches"],
}


_DIAGRAM_SCHEMA = {
    "type": "object",
    "properties": {
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "shape": {"type": "string", "enum": ["rect", "stadium", "diamond", "circle"]},
                },
                "required": ["id", "label", "shape"],
                "additionalProperties": False,
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"from": {"type": "string"}, "to": {"type": "string"}, "label": {"type": "string"}},
                "required": ["from", "to", "label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["nodes", "edges"],
    "additionalProperties": False,
}


def diagram(doc: Document, chapter_index: int | None, kind: str, layout: str, detail: str, text: str | None) -> dict:
    title, scope_text, _ = _scope(doc, chapter_index)
    source = text or scope_text
    if llm.available():
        n = {"simple": "4-5", "standard": "6-8", "detailed": "9-12"}[detail]
        kind_guide = {
            "flowchart": "a flowchart of the process or argument, in order",
            "concept": "a concept map: a central idea connected to related concepts with short verb labels",
            "block": "a block diagram of the system's components and how they connect",
        }[kind]
        try:
            data = llm.complete_json(
                llm.READER_SYSTEM,
                f"Create {kind_guide} for “{title}” with {n} nodes. Node labels: at most 6 words. "
                "Use 'diamond' only for decisions, 'stadium' for start/end, 'circle' for a central concept.\n\n"
                f"<text>\n{_trim(source, 5000)}\n</text>",
                _DIAGRAM_SCHEMA,
                max_tokens=3000,
            )
            ids = {nd["id"] for nd in data["nodes"]}
            data["edges"] = [e for e in data["edges"] if e["from"] in ids and e["to"] in ids]
            data.update(kind=kind, layout=layout, mermaid=nlp.to_mermaid(data["nodes"], data["edges"], layout))
            return _with_engine(data, llm.provider_name())
        except llm.LLMUnavailable as exc:
            log.info("diagram fallback: %s", exc)
    return _with_engine(nlp.diagram(source, title, kind, layout, detail), "local")


# ─── Quiz ─────────────────────────────────────────────────────────────────────
_QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["multiple_choice", "true_false", "short_answer"]},
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "correct": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "answer": {"type": "string"},
                },
                "required": ["type", "question", "options", "correct", "explanation", "answer"],
                "additionalProperties": False,
            },
        },
        "flashcards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"front": {"type": "string"}, "back": {"type": "string"}},
                "required": ["front", "back"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["questions", "flashcards"],
    "additionalProperties": False,
}


def quiz(doc: Document, chapter_index: int | None, count: int) -> dict:
    title, text, _ = _scope(doc, chapter_index)
    if llm.available():
        try:
            data = llm.complete_json(
                llm.READER_SYSTEM,
                f"Write a {count}-question quiz on “{title}”: mostly multiple choice (4 options), one true/false "
                "(options ['True','False']), and one short answer (empty options, correct = -1, model answer in "
                "'answer'). 'correct' is the zero-based index of the right option. 'explanation' cites the text. "
                "Also write 6-10 flashcards (term → definition from the text).\n\n"
                f"<text>\n{_trim(text, 7000)}\n</text>",
                _QUIZ_SCHEMA,
                max_tokens=6000,
            )
            for i, q in enumerate(data["questions"], 1):
                q["id"] = i
                if q["type"] == "short_answer":
                    q["keywords"] = nlp.content_words(q.get("answer", ""))[:8]
                    q["hint"] = "Use the key terms from the chapter."
            return _with_engine(data, llm.provider_name())
        except llm.LLMUnavailable as exc:
            log.info("quiz fallback: %s", exc)
    return _with_engine(nlp.quiz(text, count, corpus=[c.content for c in doc.chapters]), "local")


def recommendations(doc: Document, highlight_count: int) -> list[dict]:
    """Smart, context-aware next actions for a document."""
    recs = []
    if 0 < doc.progress < 95:
        chapter = doc.chapters[doc.current_chapter].title if doc.chapters and doc.current_chapter < len(doc.chapters) else ""
        recs.append({"action": "continue", "label": f"Continue “{doc.title}” — {chapter}", "document_id": doc.id})
    if doc.word_count > 8000:
        recs.append({"action": "summarize", "label": f"“{doc.title}” is long — generate a summary", "document_id": doc.id})
    if highlight_count >= 3:
        recs.append({"action": "mindmap", "label": f"You highlighted {highlight_count} passages — connect them in a mind map", "document_id": doc.id})
    if doc.chapters and doc.current_chapter < len(doc.chapters):
        ch = doc.chapters[doc.current_chapter]
        if ch.word_count > 3000:
            recs.append({"action": "diagram", "label": f"“{ch.title}” is dense — visualise it as a diagram", "document_id": doc.id})
        recs.append({"action": "quiz", "label": f"Quiz yourself on “{ch.title}”", "document_id": doc.id})
    return recs
