"""Local, dependency-free NLP engine.

Powers every AI feature when no LLM provider is configured, and supplies retrieval
(BM25) context to the LLM when one is. All outputs are extractive — grounded in the
document's own sentences — so nothing is invented.
"""
from __future__ import annotations

import math
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass

STOPWORDS = set(
    """a about above after again against all also am an and any are aren't as at be because been before being below
    between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few
    for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him
    himself his how how's however i i'd i'll i'm i've if in into is isn't it it's its itself just let's like made make
    makes many may me might more most much must mustn't my myself no nor not now of off often on once one only or
    other ought our ours ourselves out over own same shall shan't she she'd she'll she's should shouldn't so some such
    than that that's the their theirs them themselves then there there's these they they'd they'll they're they've
    this those though through thus to too under until up upon us use used using very was wasn't way we we'd we'll
    we're we've well were weren't what what's when when's where where's whether which while who who's whom whose why
    why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself
    yourselves get gets got even every still another something anything nothing everything someone things thing
    two three first second new say said says see seen take takes know known come comes go goes going around rather
    almost always never sometimes per via etc e.g i.e figure fig table section chapter page pp vol et al""".split()
)

# Common words that are valid tokens but make poor "key concepts".
GENERIC = set(
    """people person wrong right good bad better best great small large little long short high low part kind sort lot
    time times place way ways idea ideas text word words whole single clear simple different same important possible
    real true next last likely able quite instead later early yet less least few far near various certain particular
    general specific main major minor full free hard easy new old young able unable entire overall today year years
    day days moment moments thing whose nothing everyone anyone itself others other able become becomes became
    begin begins began give gives given keep keeps put puts turn turns want wants need needs feel feels felt look
    looks find finds found tell tells told ask asks asked work works call calls try tries seem seems leave leaves""".split()
)

# Indian scripts (Devanagari … Sinhala, 0900–0DFF) and Arabic-script Urdu: a "word" is a run of letters *and* combining
# vowel signs — Python's \w would split Tamil/Telugu/Malayalam words at every vowel sign. Sentence marks (danda, ۔ ؟) excluded.
_INDIC_LETTERS = "ऀ-ॣ०-९ॱ-෿؀-؋؍-؞ؠ-ۓە-ۿ‌‍"
_WORD_RE = re.compile(rf"[A-Za-z][A-Za-z'\-]*[A-Za-z]|[A-Za-z]|[{_INDIC_LETTERS}]+")
_SENT_SPLIT_RE = re.compile(rf"(?<=[.!?।॥۔؟])[\"')\]]?\s+(?=[\"'(\[]?[A-Z0-9{_INDIC_LETTERS}])")
_ABBREV = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|al|No)\.$")


# ─── Tokenisation ─────────────────────────────────────────────────────────────
def words(text: str) -> list[str]:
    return [w.lower().strip("'-") for w in _WORD_RE.findall(text)]


def content_words(text: str) -> list[str]:
    return [w for w in words(text) if w not in STOPWORDS and len(w) > 2]


def stem(word: str) -> str:
    for suffix in ("ations", "ation", "ingly", "ings", "ing", "ness", "ments", "ment", "ies", "ied", "es", "ed", "ly", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)] + ("y" if suffix in ("ies", "ied") else "")
    return word


def sentences(text: str) -> list[str]:
    out: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = " ".join(para.split())
        if not para:
            continue
        parts = _SENT_SPLIT_RE.split(para)
        buf = ""
        for part in parts:
            buf = f"{buf} {part}".strip() if buf else part
            if _ABBREV.search(buf):
                continue
            out.append(buf)
            buf = ""
        if buf:
            out.append(buf)
    return [s for s in out if len(s.split()) >= 3]


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


# ─── Keywords & key phrases ───────────────────────────────────────────────────
def key_phrases(text: str, top_k: int = 12, corpus: list[str] | None = None) -> list[str]:
    """Rank unigrams and bigrams by TF-IDF-weighted frequency (RAKE-like candidate generation)."""
    candidates: Counter[str] = Counter()
    for sent in sentences(text) or [text]:
        tokens = words(sent)
        run: list[str] = []
        for tok in tokens + ["."]:
            if tok in STOPWORDS or len(tok) <= 2 or tok == ".":
                if run:
                    for n in (1, 2):
                        for i in range(len(run) - n + 1):
                            candidates[" ".join(run[i : i + n])] += 1
                run = []
            else:
                run.append(tok)
    if not candidates:
        return []
    verbs = _verb_like(text)
    idf: dict[str, float] = {}
    if corpus and len(corpus) > 1:
        lowered = [c.lower() for c in corpus]
        n_docs = len(lowered)
        for phrase in candidates:
            df = sum(1 for c in lowered if phrase in c)
            idf[phrase] = math.log((n_docs + 1) / (df + 1)) + 1
    scored = []
    for phrase, freq in candidates.items():
        parts = phrase.split()
        n_words = len(parts)
        if n_words == 2 and freq < 2:
            continue
        if any(p in GENERIC for p in parts) and n_words == 1:
            continue
        if n_words == 2 and all(p in GENERIC for p in parts):
            continue
        weight = 1.0
        if n_words == 1:
            w = parts[0]
            if (w.endswith(("ed", "ly")) and len(w) > 4) or w in verbs:
                continue  # participles, adverbs and verbs rarely name a concept
            if w.endswith("ing"):
                weight = 0.6
        score = freq * (2.0 if n_words == 2 else 1.0) * weight * idf.get(phrase, 1.0)
        scored.append((score, phrase))
    scored.sort(reverse=True)

    picked: list[str] = []
    for _, phrase in scored:
        stems = {stem(w) for w in phrase.split()}
        if any(stems <= {stem(w) for w in p.split()} for p in picked):
            continue  # already covered by a picked phrase (e.g. "model" after "mental model")
        # a bigram absorbs previously picked unigrams it contains
        picked = [p for p in picked if not (len(p.split()) == 1 and stem(p) in stems)]
        picked.append(phrase)
        if len(picked) >= top_k:
            break
    return [_display_case(p, text) for p in picked]


_SUBJECTS = {"it", "that", "which", "this", "who", "he", "she", "what", "they", "we", "i", "you", "to", "can", "could",
             "will", "would", "may", "might", "must", "should", "does", "do", "did", "not", "also", "often"}
_OBJECTS = {"us", "you", "them", "me", "him", "her", "it", "people", "readers", "users"}


def _verb_like(text: str) -> set[str]:
    """Words used as verbs in context ("it lets us", "can support") — cheap stand-in for POS tagging."""
    toks = words(text)
    verb_votes: Counter[str] = Counter()
    noun_votes: Counter[str] = Counter()
    for i, t in enumerate(toks):
        prev = toks[i - 1] if i else ""
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        if prev in _SUBJECTS or nxt in _OBJECTS:
            verb_votes[t] += 1
        if prev in ("the", "a", "an", "of", "this", "their", "our", "its"):
            noun_votes[t] += 1
    return {w for w, v in verb_votes.items() if v > noun_votes[w]}


def _display_case(phrase: str, text: str) -> str:
    m = re.search(re.escape(phrase), text, re.IGNORECASE)
    if m:
        original = m.group(0)
        if original[0].isupper() and not original.isupper():
            return original
    return phrase[0].upper() + phrase[1:]


# ─── Sentence ranking (TextRank-lite) ─────────────────────────────────────────
def rank_sentences(text: str, query: str | None = None) -> list[tuple[float, int, str]]:
    sents = sentences(text)
    if not sents:
        return []
    freq = Counter(stem(w) for w in content_words(text))
    if not freq:
        return [(0.0, i, s) for i, s in enumerate(sents)]
    top = freq.most_common(1)[0][1]
    query_terms = {stem(w) for w in content_words(query)} if query else set()
    scored = []
    for i, s in enumerate(sents):
        toks = [stem(w) for w in content_words(s)]
        if not toks:
            continue
        score = sum(freq[t] / top for t in toks) / (len(toks) ** 0.6)
        if i < 3:
            score *= 1.25  # lead bias
        if s.startswith(("\"", "“")):
            score *= 1.1
        if re.search(r"\b(is|are|means|refers to|defined as|called)\b", s):
            score *= 1.15
        if re.search(r"\b(therefore|thus|in short|in summary|the key|importantly|crucial|essential)\b", s, re.I):
            score *= 1.2
        n = len(s.split())
        if n < 7 or n > 55:
            score *= 0.6
        if query_terms:
            overlap = len(query_terms & set(toks))
            score *= (1 + overlap * 2.0) if overlap else 0.3
        scored.append((score, i, s))
    scored.sort(key=lambda t: t[0], reverse=True)
    return scored


def top_sentences(text: str, n: int, query: str | None = None) -> list[str]:
    ranked = rank_sentences(text, query)[: max(n * 3, n)]
    chosen: list[tuple[int, str]] = []
    for _score, idx, sent in ranked:
        if any(_similar(sent, c[1]) for c in chosen):
            continue
        chosen.append((idx, sent))
        if len(chosen) >= n:
            break
    return [s for _, s in sorted(chosen)]


def _similar(a: str, b: str, threshold: float = 0.55) -> bool:
    sa, sb = set(content_words(a)), set(content_words(b))
    if not sa or not sb:
        return False
    return len(sa & sb) / min(len(sa), len(sb)) >= threshold


# ─── BM25 retrieval ───────────────────────────────────────────────────────────
@dataclass
class Passage:
    text: str
    chapter_index: int
    chapter_title: str


class BM25Index:
    def __init__(self, passages: list[Passage], k1: float = 1.4, b: float = 0.75):
        self.passages = passages
        self.k1, self.b = k1, b
        self.docs = [[stem(w) for w in content_words(p.text)] for p in passages]
        self.avgdl = (sum(len(d) for d in self.docs) / len(self.docs)) if self.docs else 0
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def search(self, query: str, k: int = 5) -> list[tuple[float, Passage]]:
        q = [stem(w) for w in content_words(query)]
        if not q or not self.passages:
            return []
        results = []
        for i, tf in enumerate(self.tf):
            dl = len(self.docs[i]) or 1
            score = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    score += self.idf.get(t, 0) * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1)))
            if score > 0:
                results.append((score, self.passages[i]))
        results.sort(key=lambda r: r[0], reverse=True)
        return results[:k]


def build_passages(chapters: list[tuple[int, str, str]], max_words: int = 140) -> list[Passage]:
    """chapters: [(index, title, content)] → overlapping-free passages of ~max_words."""
    out: list[Passage] = []
    for idx, title, content in chapters:
        buf: list[str] = []
        count = 0
        for para in paragraphs(content):
            n = len(para.split())
            if count and count + n > max_words:
                out.append(Passage(" ".join(buf), idx, title))
                buf, count = [], 0
            buf.append(para)
            count += n
        if buf:
            out.append(Passage(" ".join(buf), idx, title))
    return out


# ─── Feature: summary ─────────────────────────────────────────────────────────
DEPTH_CONFIG = {"brief": (3, 5), "standard": (6, 8), "deep": (10, 12)}


def summarize(text: str, title: str, depth: str = "standard", corpus: list[str] | None = None) -> dict:
    n_points, n_concepts = DEPTH_CONFIG.get(depth, DEPTH_CONFIG["standard"])
    ranked = top_sentences(text, n_points + 2)
    main_idea = ranked[0] if ranked else f"{title} could not be summarised — it contains too little text."
    key_points = [s for s in ranked[1:] if s != main_idea][:n_points]
    concepts = key_phrases(text, n_concepts, corpus)
    examples = [
        s for s in sentences(text)
        if re.search(r"\b(for example|for instance|such as|consider|imagine|e\.g\.)\b", s, re.I) and 8 <= len(s.split()) <= 60
    ][: 2 if depth == "brief" else 4]
    conclusion_like = [
        s for s in sentences(text)
        if re.search(r"\b(therefore|thus|in short|in summary|ultimately|the lesson|we must|should)\b", s, re.I)
    ]
    takeaway = conclusion_like[-1] if conclusion_like else (key_points[-1] if key_points else main_idea)
    questions = suggested_questions(concepts, title)
    words_total = len(text.split())
    return {
        "depth": depth,
        "main_idea": main_idea,
        "key_points": key_points,
        "concepts": concepts,
        "examples": examples if depth != "brief" else examples[:1],
        "takeaways": takeaway,
        "suggested_questions": questions,
        "reading_time_saved_min": max(1, round(words_total / 230) - max(1, round(sum(len(s.split()) for s in ranked) / 230))),
    }


def suggested_questions(concepts: list[str], title: str) -> list[str]:
    qs = []
    if concepts:
        qs.append(f"What does the text mean by “{concepts[0]}”?")
    if len(concepts) > 1:
        qs.append(f"How are {concepts[0].lower()} and {concepts[1].lower()} related?")
    if len(concepts) > 2:
        qs.append(f"Why is {concepts[2].lower()} important here?")
    qs.append(f"What should I remember about “{title}” for an exam?")
    return qs[:4]


# ─── Feature: explain / define ────────────────────────────────────────────────
def find_definitions(term: str, text: str, limit: int = 3) -> list[str]:
    t = re.escape(term.strip())
    patterns = [
        rf"\b{t}\b[^.]{{0,40}}\b(is|are|was|were|means|refers to|describes|denotes)\b",
        rf"\b(called|known as|termed|defined as)\b[^.]{{0,20}}\b{t}\b",
        rf"\b{t}\b\s*[—–:-]\s*",
    ]
    found = []
    for s in sentences(text):
        if any(re.search(p, s, re.I) for p in patterns) and len(s.split()) <= 70:
            found.append(s)
        if len(found) >= limit:
            break
    if not found:
        found = [s for s in sentences(text) if re.search(rf"\b{t}\b", s, re.I)][:limit]
    return found


def simplify_sentence(s: str) -> str:
    s = re.sub(r"\s*\([^)]*\)", "", s)
    s = re.sub(r",\s*(which|who|whereby)\s+[^,]+,", ",", s)
    replacements = {
        r"\butili[sz]e\b": "use", r"\bfacilitate\b": "help", r"\bnumerous\b": "many", r"\bcommence\b": "start",
        r"\bsubsequently\b": "later", r"\bapproximately\b": "about", r"\bdemonstrate\b": "show",
        r"\bin order to\b": "to", r"\bnevertheless\b": "still", r"\bconsequently\b": "so", r"\bperceive\b": "notice",
        r"\bmethodology\b": "method", r"\bparadigm\b": "model", r"\bindividuals\b": "people", r"\bobtain\b": "get",
    }
    for pat, rep in replacements.items():
        s = re.sub(pat, rep, s, flags=re.I)
    return " ".join(s.split())


def explain(selection: str, mode: str, context: str = "") -> dict:
    sel_sents = sentences(selection) or [selection.strip()]
    terms = key_phrases(selection, 4) or [selection.strip()[:60]]
    definitions = []
    for term in terms[:3]:
        defs = [d for d in find_definitions(term, context or selection, 1) if d.strip() != selection.strip()]
        if defs:
            definitions.append({"term": term, "definition": defs[0]})
    related = []
    if context:
        idx = BM25Index(build_passages([(0, "", context)], 60))
        for _score, p in idx.search(selection, 4):
            if p.text.strip()[:80] not in selection:
                related.append(p.text if len(p.text) < 400 else p.text[:400].rsplit(" ", 1)[0] + "…")
        related = related[:2]
    core = sel_sents[0]
    simple = " ".join(simplify_sentence(s) for s in sel_sents[:3])
    focus = terms[0]

    if mode == "simple":
        body = f"In plain words: {simple}"
        if definitions:
            body += f" Here, “{definitions[0]['term']}” is the key idea — {simplify_sentence(definitions[0]['definition'])}"
    elif mode == "student":
        body = (
            f"Think of it this way: the passage is about **{focus.lower()}**. {simple} "
            f"To remember it, ask yourself: what changes because of {focus.lower()}, and why does the author care?"
        )
    elif mode == "expert":
        concepts = ", ".join(t.lower() for t in terms)
        body = (
            f"The passage advances a claim centred on {concepts}. {core} "
            + (f"It builds on the text's own framing elsewhere: {related[0]} " if related else "")
            + "Critically, consider which assumptions this depends on and what evidence would weaken it."
        )
    elif mode == "example":
        examples = [s for s in sentences(context) if re.search(r"\b(for example|for instance|such as|consider|imagine)\b", s, re.I)]
        relevant = [e for e in examples if any(w in e.lower() for w in focus.lower().split())] or examples
        body = (
            f"An example from the text: {relevant[0]}" if relevant
            else f"Example: imagine applying “{focus.lower()}” to an object you use every day — {simple}"
        )
    else:  # analogy
        body = (
            f"Analogy: {focus} works a bit like a road sign — it tells you what to do next without you having to "
            f"stop and think. In the passage's terms: {simple}"
        )
    return {
        "mode": mode,
        "explanation": body,
        "key_terms": definitions,
        "related_passages": related,
        "engine": "local",
    }


# ─── Feature: chat (retrieval-grounded answers) ───────────────────────────────
def answer_question(question: str, index: BM25Index, k: int = 4) -> dict:
    hits = index.search(question, k)
    if not hits:
        return {
            "answer": "I couldn't find anything about that in this document. Try rephrasing the question with words "
                      "the author would use, or ask about a specific chapter.",
            "citations": [],
            "confidence": 0.0,
        }
    q_lower = question.lower()
    wants_summary = any(k in q_lower for k in ("main idea", "summar", "about", "key concept", "overview"))
    wants_exam = "exam" in q_lower or "remember" in q_lower
    pool = " ".join(p.text for _, p in hits)
    best = top_sentences(pool, 4 if (wants_summary or wants_exam) else 3, query=question)
    if wants_exam:
        answer = "For an exam, focus on these points from the text:\n" + "\n".join(f"• {s}" for s in best)
    else:
        answer = " ".join(best)
    citations = []
    seen = set()
    for score, p in hits:
        key = (p.chapter_index, p.text[:40])
        if key in seen:
            continue
        seen.add(key)
        snippet = p.text if len(p.text) < 260 else p.text[:260].rsplit(" ", 1)[0] + "…"
        citations.append({"chapter_index": p.chapter_index, "chapter_title": p.chapter_title, "snippet": snippet, "score": round(score, 2)})
    top_score = hits[0][0]
    return {"answer": answer, "citations": citations[:3], "confidence": round(min(1.0, top_score / 12), 2)}


# ─── Feature: mind map ────────────────────────────────────────────────────────
def mind_map(title: str, chapters: list[tuple[int, str, str]]) -> dict:
    corpus = [c[2] for c in chapters]
    root = {"id": "root", "label": title, "children": []}
    if len(chapters) > 1:
        for idx, ch_title, content in chapters[:14]:
            phrases = key_phrases(content, 5, corpus)
            node = {"id": f"c{idx}", "label": ch_title, "chapter_index": idx, "children": []}
            for j, ph in enumerate(phrases):
                defs = find_definitions(ph, content, 1)
                node["children"].append({"id": f"c{idx}-{j}", "label": ph, "detail": defs[0] if defs else None, "chapter_index": idx, "children": []})
            root["children"].append(node)
    else:
        idx, ch_title, content = chapters[0]
        phrases = key_phrases(content, 18)
        clusters = _cluster_phrases(phrases, content)
        for j, (head, members) in enumerate(clusters):
            defs = find_definitions(head, content, 1)
            node = {"id": f"k{j}", "label": head, "detail": defs[0] if defs else None, "chapter_index": idx, "children": []}
            for m_i, m in enumerate(members):
                d = find_definitions(m, content, 1)
                node["children"].append({"id": f"k{j}-{m_i}", "label": m, "detail": d[0] if d else None, "chapter_index": idx, "children": []})
            root["children"].append(node)
    return {"root": root}


def _cluster_phrases(phrases: list[str], text: str, n_clusters: int = 5) -> list[tuple[str, list[str]]]:
    """Group phrases by sentence co-occurrence; the strongest phrases become branch heads."""
    sents = [s.lower() for s in sentences(text)]
    occ = {p: {i for i, s in enumerate(sents) if p.lower() in s} for p in phrases}
    heads = phrases[:n_clusters]
    groups: dict[str, list[str]] = {h: [] for h in heads}
    for p in phrases[n_clusters:]:
        best, best_score = None, 0
        for h in heads:
            score = len(occ[p] & occ[h])
            if score > best_score:
                best, best_score = h, score
        target = best or min(heads, key=lambda h: len(groups[h]))
        if len(groups[target]) < 4:
            groups[target].append(p)
    return list(groups.items())


# ─── Feature: diagrams ────────────────────────────────────────────────────────
_STEP_MARKERS = re.compile(r"\b(first|firstly|second|secondly|third|then|next|after that|afterwards|finally|lastly|subsequently)\b", re.I)


def _short_label(s: str, max_words: int = 7) -> str:
    s = re.sub(r"^\W+|\W+$", "", s)
    s = re.sub(r"^(first(ly)?|second(ly)?|third|then|next|after that|finally|lastly|and|or)\b[,\s]*", "", s, flags=re.I)
    ws = s.split()
    label = " ".join(ws[:max_words])
    return (label[0].upper() + label[1:] + ("…" if len(ws) > max_words else "")) if label else "Step"


def extract_steps(text: str, max_steps: int = 8) -> list[str]:
    # 1) explicit enumerations inside one sentence: "...: forming a goal, planning..., and evaluating..."
    for s in sentences(text):
        m = re.search(r"(?:stages?|steps?|phases?|cycle|process|sequence)[^:]{0,80}:\s*(.+)", s, re.I)
        if m:
            items = [i.strip() for i in re.split(r",\s*(?:and\s+|or\s+)?|;\s*|\band\b(?=[^,]*$)", m.group(1)) if len(i.strip().split()) >= 1]
            items = [i for i in items if 1 <= len(i.split()) <= 14]
            if len(items) >= 3:
                return [_short_label(i) for i in items[:max_steps]]
    # 2) numbered / bulleted lines
    listed = re.findall(r"(?m)^\s*(?:\d+[.)]|[-*•])\s+(.+)$", text)
    if len(listed) >= 3:
        return [_short_label(i) for i in listed[:max_steps]]
    # 3) sentences with sequence markers
    seq = [s for s in sentences(text) if _STEP_MARKERS.search(s)]
    if len(seq) >= 3:
        return [_short_label(s) for s in seq[:max_steps]]
    # 4) fall back to the most important sentences in reading order
    return [_short_label(s) for s in top_sentences(text, min(max_steps, 6))]


def diagram(text: str, title: str, kind: str = "flowchart", layout: str = "TD", detail: str = "standard") -> dict:
    max_nodes = {"simple": 5, "standard": 7, "detailed": 10}.get(detail, 7)
    nodes: list[dict] = []
    edges: list[dict] = []
    if kind == "flowchart":
        steps = extract_steps(text, max_nodes)
        nodes.append({"id": "start", "label": _short_label(title, 6), "shape": "stadium"})
        prev = "start"
        for i, step in enumerate(steps):
            nid = f"s{i}"
            shape = "diamond" if re.search(r"\b(if|whether|evaluate|decide|compare|check)\b", step, re.I) else "rect"
            nodes.append({"id": nid, "label": step, "shape": shape})
            edges.append({"from": prev, "to": nid, "label": ""})
            prev = nid
        if len(steps) >= 3 and re.search(r"\b(cycle|loop|repeat|iterat|revis)", text, re.I):
            edges.append({"from": prev, "to": "s0", "label": "repeat"})
    else:
        concepts = key_phrases(text, max_nodes)
        center = _short_label(title, 5)
        nodes.append({"id": "c", "label": center, "shape": "circle" if kind == "concept" else "rect"})
        sents = sentences(text)
        for i, c in enumerate(concepts):
            nid = f"n{i}"
            nodes.append({"id": nid, "label": c, "shape": "rect"})
            verb = _relation_verb(c, sents)
            edges.append({"from": "c", "to": nid, "label": verb})
        # cross-links between co-occurring concepts
        for i, a in enumerate(concepts):
            for j in range(i + 1, len(concepts)):
                b = concepts[j]
                if sum(1 for s in sents if a.lower() in s.lower() and b.lower() in s.lower()) >= 2:
                    edges.append({"from": f"n{i}", "to": f"n{j}", "label": "relates"})
    return {"kind": kind, "layout": layout, "nodes": nodes, "edges": edges, "mermaid": to_mermaid(nodes, edges, layout)}


def _relation_verb(concept: str, sents: list[str]) -> str:
    for s in sents:
        m = re.search(rf"\b{re.escape(concept)}\b\s+(\w+)", s, re.I)
        if m and m.group(1).lower() in ("is", "are", "creates", "causes", "enables", "requires", "shapes", "affects", "communicates", "describes", "determines"):
            return m.group(1).lower()
    return "includes"


def to_mermaid(nodes: list[dict], edges: list[dict], layout: str = "TD") -> str:
    shapes = {"rect": ("[", "]"), "stadium": ("([", "])"), "diamond": ("{", "}"), "circle": ("((", "))")}
    lines = [f"flowchart {layout}"]
    for n in nodes:
        o, c = shapes.get(n.get("shape", "rect"), ("[", "]"))
        label = n["label"].replace('"', "'")
        lines.append(f'    {n["id"]}{o}"{label}"{c}')
    for e in edges:
        lbl = f'|{e["label"]}|' if e.get("label") else ""
        lines.append(f"    {e['from']} -->{lbl} {e['to']}")
    return "\n".join(lines)


# ─── Feature: quiz & flashcards ───────────────────────────────────────────────
def quiz(text: str, count: int = 6, seed: int | None = None, corpus: list[str] | None = None) -> dict:
    rng = random.Random(seed)
    phrases = key_phrases(text, 24, corpus)
    single_words = [p for p in phrases if len(p.split()) <= 2]
    ranked = [s for _, _, s in rank_sentences(text)]
    questions: list[dict] = []
    used_answers: set[str] = set()
    used_sents: set[str] = set()

    for sent in ranked:
        if len(questions) >= max(1, count - 2):
            break
        if len(sent.split()) > 45 or sent in used_sents:
            continue
        target = next((p for p in single_words if p.lower() not in used_answers and re.search(rf"\b{re.escape(p)}\b", sent, re.I)), None)
        if not target:
            continue
        distractors = [p for p in single_words if p.lower() != target.lower() and p.lower() not in sent.lower()]
        if len(distractors) < 3:
            continue
        options = rng.sample(distractors, 3) + [target]
        rng.shuffle(options)
        blanked = re.sub(rf"\b{re.escape(target)}\b", "_____", sent, count=1, flags=re.I)
        questions.append({
            "id": len(questions) + 1,
            "type": "multiple_choice",
            "question": f"Fill in the blank: {blanked}",
            "options": options,
            "correct": options.index(target),
            "explanation": sent,
        })
        used_answers.add(target.lower())
        used_sents.add(sent)

    # true/false from a real sentence vs. a perturbed one
    tf_source = next((s for s in ranked if s not in used_sents and 8 <= len(s.split()) <= 35), None)
    if tf_source:
        negated = _negate(tf_source)
        is_true = rng.random() < 0.5 or negated == tf_source
        questions.append({
            "id": len(questions) + 1,
            "type": "true_false",
            "question": f"True or false: {tf_source if is_true else negated}",
            "options": ["True", "False"],
            "correct": 0 if is_true else 1,
            "explanation": f"The text says: {tf_source}",
        })

    # short answer from a definition
    for p in phrases:
        defs = find_definitions(p, text, 1)
        if defs:
            questions.append({
                "id": len(questions) + 1,
                "type": "short_answer",
                "question": f"In your own words, explain “{p}”.",
                "hint": "Think about how the author introduces this idea.",
                "answer": defs[0],
                "keywords": content_words(defs[0])[:8],
            })
            break
    return {"questions": questions[:count], "flashcards": flashcards(text, phrases)}


def _negate(sentence: str) -> str:
    swaps = [(r"\bis\b", "is not"), (r"\bare\b", "are not"), (r"\bcan\b", "cannot"), (r"\bshould\b", "should not"),
             (r"\bwill\b", "will not"), (r"\bmust\b", "need not"), (r"\balways\b", "never"), (r"\bmore\b", "less")]
    for pat, rep in swaps:
        if re.search(pat, sentence):
            return re.sub(pat, rep, sentence, count=1)
    return sentence


def flashcards(text: str, phrases: list[str] | None = None, limit: int = 10) -> list[dict]:
    phrases = phrases or key_phrases(text, 20)
    cards = []
    used_backs: set[str] = set()
    for p in phrases:
        defs = [d for d in find_definitions(p, text, 2) if d not in used_backs]
        if defs:
            cards.append({"front": p, "back": defs[0]})
            used_backs.add(defs[0])
        if len(cards) >= limit:
            break
    return cards


def grade_short_answer(answer: str, reference: str) -> dict:
    ref = {stem(w) for w in content_words(reference)}
    got = {stem(w) for w in content_words(answer)}
    if not ref:
        return {"score": 0.0, "feedback": "No reference answer available."}
    score = len(ref & got) / len(ref)
    feedback = (
        "Excellent — you captured the key ideas." if score >= 0.5
        else "Good start — try to include more of the key terms." if score >= 0.25
        else "Review this passage and try again."
    )
    return {"score": round(min(1.0, score * 1.6), 2), "feedback": feedback, "missing": sorted(ref - got)[:6]}


# ─── Feature: compare two concepts ────────────────────────────────────────────
def compare(text: str, a: str, b: str) -> dict:
    sa = [s for s in sentences(text) if re.search(rf"\b{re.escape(a)}", s, re.I)]
    sb = [s for s in sentences(text) if re.search(rf"\b{re.escape(b)}", s, re.I)]
    both = [s for s in sa if s in sb]
    return {
        "a": {"concept": a, "evidence": sa[:3]},
        "b": {"concept": b, "evidence": sb[:3]},
        "connection": both[:2],
        "summary": (
            f"The text connects {a} and {b} directly: {both[0]}" if both
            else f"The text discusses {a} and {b} separately — compare the evidence below to see how they differ."
            if sa and sb else f"The document says little about {'both' if not sa and not sb else (a if not sa else b)}."
        ),
    }


# ─── Research helpers ─────────────────────────────────────────────────────────
def shingles(text: str, n: int = 5) -> set[tuple[str, ...]]:
    toks = words(text)
    return {tuple(toks[i : i + n]) for i in range(len(toks) - n + 1)}


def similarity_flags(draft: str, sources: list[tuple[str, str]], threshold: float = 0.12) -> list[dict]:
    """Flag draft sentences that overlap heavily with a source (5-gram shingle containment)."""
    flags = []
    source_sh = [(label, shingles(txt)) for label, txt in sources if txt]
    for s in sentences(draft):
        sh = shingles(s)
        if len(sh) < 3:
            continue
        for label, src in source_sh:
            overlap = len(sh & src) / len(sh)
            if overlap >= threshold:
                flags.append({
                    "sentence": s,
                    "source": label,
                    "overlap": round(overlap, 2),
                    "advice": "Consider paraphrasing" if overlap > 0.4 else "Review similarity and add a citation",
                })
                break
    return flags


def uncited_claims(draft: str) -> list[str]:
    claims = []
    for s in sentences(draft):
        if re.search(r"\[\d+\]|\([A-Z][A-Za-z\-]+(?: et al\.)?,? \d{4}\)", s):
            continue
        if re.search(r"\b(studies|research|evidence|shown|found|demonstrat|report|significant|percent|%|\d{2,})\b", s, re.I):
            claims.append(s)
    return claims[:8]


def word_frequency_profile(text: str) -> dict[str, int]:
    counts: defaultdict[str, int] = defaultdict(int)
    for w in content_words(text):
        counts[w] += 1
    return dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:30])
