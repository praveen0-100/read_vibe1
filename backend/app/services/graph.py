"""Knowledge graph across documents: concepts as nodes, same-paragraph co-occurrence as edges.

Every node and edge keeps locators to the paragraphs that justify it (source, chapter, paragraph, PDF page), so the graph is
an index into the sources, never a free-standing claim. Edges mean "these ideas appear together in the text", not a
verified relationship; the UI labels them that way.
"""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations

from ..models import Document
from . import nlp, provenance

MAX_EVIDENCE = 3


def build(docs: list[Document], max_nodes: int = 40, per_doc_phrases: int = 24) -> dict:
    units: list[tuple[Document, int, int, str, str]] = []  # (doc, chapter, paragraph, chapter_title, lowercase text)
    phrases_by_doc: dict[str, list[str]] = {}
    for d in docs:
        text = "\n\n".join(c.content for c in d.chapters)
        phrases_by_doc[d.id] = [p for p in nlp.key_phrases(text, per_doc_phrases) if 3 <= len(p) <= 40]
        for ci, pi, title, para in provenance._paragraph_units(d):
            units.append((d, ci, pi, title, para.lower()))

    node_docs: dict[str, set[str]] = defaultdict(set)
    label: dict[str, str] = {}
    for d in docs:
        for p in phrases_by_doc[d.id]:
            key = p.lower()
            node_docs[key].add(d.id)
            label.setdefault(key, p)

    mentions: dict[str, int] = defaultdict(int)
    evidence: dict[str, list[dict]] = defaultdict(list)
    pair_weight: dict[tuple[str, str], int] = defaultdict(int)
    pair_evidence: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for d, ci, pi, title, low in units:
        present = [k for k in node_docs if k in low and d.id in node_docs[k]]
        if not present:
            continue
        loc = provenance.locator(d, ci, pi)
        for k in present:
            mentions[k] += 1
            if len(evidence[k]) < MAX_EVIDENCE:
                evidence[k].append(loc)
        for a, b in combinations(sorted(present), 2):
            pair_weight[(a, b)] += 1
            if len(pair_evidence[(a, b)]) < MAX_EVIDENCE:
                pair_evidence[(a, b)].append(loc)

    keep = sorted((k for k in mentions), key=lambda k: (-len(node_docs[k]), -mentions[k], k))[:max_nodes]
    keep_set = set(keep)
    nodes = [{"id": k, "label": label[k], "mentions": mentions[k], "sources": sorted(node_docs[k]),
              "shared": len(node_docs[k]) > 1, "evidence": evidence[k]} for k in keep]
    edges = [{"source": a, "target": b, "weight": w, "evidence": pair_evidence[(a, b)]}
             for (a, b), w in sorted(pair_weight.items(), key=lambda kv: -kv[1]) if a in keep_set and b in keep_set]
    return {
        "documents": [{"id": d.id, "title": d.title} for d in docs],
        "nodes": nodes,
        "edges": edges[: max_nodes * 3],
        "note": "Concepts are key phrases from your documents; a link means two ideas appear in the same paragraph, not that they are proven to be related.",
    }
