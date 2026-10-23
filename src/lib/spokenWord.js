// ─── Word-level helpers for read-aloud ───────────────────────────────────────
// Paragraph elements carry `data-p` (see ChapterText). Character offsets below are positions in that paragraph's text,
// the same space the narration script uses, so a click can start speech at a word and speech can light up the word.

export const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

const WORD_CHAR = /[\p{L}\p{M}\p{N}'’_\-\u200c\u200d]/u; // \p{M}: vowel signs of Indian scripts belong to the word
const TOLERANCE = 4; // px of slack around a word's box when hit-testing a tap

/** DOM Range covering [from, to) of an element's text content. */
export function rangeFor(el, from, to) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let started = false;
  let node;
  while ((node = walker.nextNode())) {
    const end = pos + node.data.length;
    if (!started && from < end) { range.setStart(node, Math.max(0, from - pos)); started = true; }
    if (started && to <= end) { range.setEnd(node, Math.max(0, to - pos)); return range; }
    pos = end;
  }
  if (!started) { range.selectNodeContents(el); range.collapse(false); } else range.setEndAfter(el.lastChild);
  return range;
}

/** [start, end) of the word containing `index` in `text` (snaps forward when `index` sits on whitespace). */
export function wordBounds(text, index) {
  let s = Math.min(Math.max(0, index), text.length);
  while (s < text.length && !WORD_CHAR.test(text[s])) s += 1;
  let from = s;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from -= 1;
  let to = s;
  while (to < text.length && WORD_CHAR.test(text[to])) to += 1;
  return [from, to];
}

/** The word under a pointer inside `root`, or null when the pointer is on whitespace/margins/other UI. */
export function wordAtPoint(x, y, root) {
  let node;
  let offset;
  if (document.caretPositionFromPoint) {
    const c = document.caretPositionFromPoint(x, y);
    node = c?.offsetNode;
    offset = c?.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    offset = r?.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root?.contains(node)) return null;
  const pEl = node.parentElement?.closest('[data-p]');
  if (!pEl) return null;

  const text = node.data;
  let s = offset;
  let e = offset;
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s -= 1;
  while (e < text.length && WORD_CHAR.test(text[e])) e += 1;
  if (s === e) return null;

  const range = document.createRange();
  range.setStart(node, s);
  range.setEnd(node, e);
  const hit = [...range.getClientRects()].find((r) => x >= r.left - TOLERANCE && x <= r.right + TOLERANCE && y >= r.top - TOLERANCE && y <= r.bottom + TOLERANCE);
  if (!hit) return null;

  const before = document.createRange();
  before.selectNodeContents(pEl);
  before.setEnd(node, s);
  const start = before.toString().length;
  return { p: Number(pEl.dataset.p), start, end: start + (e - s), word: text.slice(s, e), rect: hit };
}

/** Bounding box of the word at `charIndex` of paragraph `p` (null when the paragraph isn't rendered). */
export function wordRect(root, p, charIndex) {
  const el = root?.querySelector(`[data-p="${p}"]`);
  if (!el) return null;
  const [s, e] = wordBounds(el.textContent, charIndex);
  const rects = rangeFor(el, s, e).getClientRects();
  return rects[0] || null;
}

/** Light up the word being spoken (and dim-mark what was already read in the paragraph) without touching the DOM. */
export function showSpokenWord(root, p, charIndex) {
  if (!supportsHighlights) return;
  const el = root?.querySelector(`[data-p="${p}"]`);
  if (!el) { clearSpokenWord(); return; }
  const [s, e] = wordBounds(el.textContent, charIndex);
  CSS.highlights.set('rv-word', new Highlight(rangeFor(el, s, e)));
  CSS.highlights.set('rv-read', new Highlight(rangeFor(el, 0, s)));
}

export function clearSpokenWord() {
  if (!supportsHighlights) return;
  CSS.highlights.delete('rv-word');
  CSS.highlights.delete('rv-read');
}
