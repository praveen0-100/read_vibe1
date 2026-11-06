// ReadVibe's own text selection for touch screens.
//
// On a phone, holding a word makes the browser draw ITS selection UI: a floating Define / Copy / Select all / Web search bar and (on
// Android) Google's "Tap to see search results" sheet, both landing on top of ReadVibe's Annotate / Look Up / Note toolbar. They cannot
// be switched off while native selection is in use, so on touch devices the text is made non-selectable (class `ts-on`) and this
// hook provides the selection instead: hold a word to select it, keep dragging to extend, drag the two handles to adjust, tap
// anywhere else to dismiss. The result is reported through `onSelect({ text, rect })` — the same toolbar the desktop selection uses.
import React, { useCallback, useEffect, useRef, useState } from 'react';

const WORD = /[\p{L}\p{N}_'’-]/u;
const HOLD_MS = 420;
const MOVE_SLOP = 10;
const FINGER_LIFT = 28; // while dragging a handle, aim at the line ABOVE the fingertip so the finger doesn't hide it

/** Shared with the reader's tap / swipe handlers so a selection gesture never turns the page. */
export const touchSelectState = { active: false, lastEnd: 0, recently: () => touchSelectState.active || Date.now() - touchSelectState.lastEnd < 380 };

export const isTouchDevice = () => {
  try { if (localStorage.getItem('rv.touchselect') === '1') return true; } catch { /* storage unavailable */ }
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0));
};

function caretAt(x, y, root) {
  let node; let offset;
  if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); node = c?.offsetNode; offset = c?.offset; }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; offset = r?.startOffset; }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root?.contains(node)) return null;
  return { node, offset };
}

function wordAround({ node, offset }) {
  const t = node.data;
  let s = Math.min(offset, t.length); let e = s;
  while (s > 0 && WORD.test(t[s - 1])) s -= 1;
  while (e < t.length && WORD.test(t[e])) e += 1;
  if (s === e) { // landed on a space or punctuation: take the neighbouring word
    if (offset < t.length) { e = offset + 1; while (e < t.length && WORD.test(t[e])) e += 1; s = offset; }
    else return null;
  }
  return { start: { node, offset: s }, end: { node, offset: e } };
}

const before = (a, b) => {
  const r = document.createRange();
  r.setStart(a.node, a.offset); r.collapse(true);
  return r.comparePoint(b.node, b.offset) >= 0; // a is at or before b
};

function build(start, end) {
  const r = document.createRange();
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset);
  return r;
}

const clean = (range) => range.toString().replace(/\s+/g, ' ').trim();

export default function useTouchSelection({ rootRef, enabled, onSelect, watch }) {
  const [range, setRange] = useState(null);
  const [live, setLive] = useState(false); // true while the finger is still moving the selection (toolbar hidden)
  const st = useRef({ timer: 0, x: 0, y: 0, base: null, extending: false, range: null });
  const cb = useRef(onSelect);
  cb.current = onSelect;

  const report = useCallback((r) => {
    if (!r || r.collapsed) { cb.current?.(null); return; }
    const text = clean(r);
    cb.current?.(text.length >= 2 ? { text: text.slice(0, 4000), rect: r.getBoundingClientRect() } : null);
  }, []);

  const clear = useCallback((silent = false) => {
    clearTimeout(st.current.timer);
    const had = !!st.current.range;
    st.current.range = null; st.current.base = null; st.current.extending = false;
    setRange(null); setLive(false);
    if (had) { touchSelectState.active = false; touchSelectState.lastEnd = Date.now(); if (!silent) cb.current?.(null); }
  }, []);

  const apply = useCallback((r) => { st.current.range = r; setRange(r); }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;
    root.classList.add('ts-on');
    const s = st.current;

    const interactive = (t) => t.closest?.('[data-hl], a, button, input, textarea, .selection-toolbar, .popover, .modal, .ts-handle');
    const onStart = (e) => {
      if (e.touches.length !== 1) { clearTimeout(s.timer); return; }
      const t = e.touches[0];
      if (interactive(e.target)) return;
      if (s.range) { clear(); return; }   // a tap away from the selection dismisses it (and is swallowed by lastEnd)
      s.x = t.clientX; s.y = t.clientY;
      clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        const c = caretAt(s.x, s.y, root);
        const w = c && wordAround(c);
        if (!w) return;
        s.base = w; s.extending = true;
        touchSelectState.active = true;
        apply(build(w.start, w.end)); setLive(true); cb.current?.(null);
        try { navigator.vibrate?.(12); } catch { /* not supported */ }
      }, HOLD_MS);
    };
    const onMove = (e) => {
      const t = e.touches[0];
      if (!s.extending) {
        if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > MOVE_SLOP) clearTimeout(s.timer);
        return;
      }
      if (e.cancelable) e.preventDefault();
      const c = caretAt(t.clientX, t.clientY - 6, root);
      const w = c && wordAround(c);
      if (!w) return;
      const { base } = s;
      apply(before(w.start, base.start) ? build(w.start, base.end) : build(base.start, w.end));
    };
    const onEnd = (e) => {
      clearTimeout(s.timer);
      if (!s.extending) return;
      s.extending = false; setLive(false);
      if (e.cancelable) e.preventDefault(); // the long-press must not also "click" through to a page turn
      report(s.range);
    };
    const onMenu = (e) => e.preventDefault(); // Android raises `contextmenu` on a long press: keep its menu away too

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onEnd, { passive: false });
    root.addEventListener('contextmenu', onMenu);
    return () => {
      root.classList.remove('ts-on');
      root.removeEventListener('touchstart', onStart); root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd); root.removeEventListener('touchcancel', onEnd);
      root.removeEventListener('contextmenu', onMenu);
      clearTimeout(s.timer);
    };
  }, [enabled, rootRef, apply, clear, report, watch]); // `watch` re-binds when the reading surface is swapped (paged <-> scrolling layout)

  /** Move one end of the selection (called by the handle components). */
  const moveHandle = useCallback((which, x, y) => {
    const r = st.current.range;
    const root = rootRef.current;
    if (!r || !root) return;
    const c = caretAt(x, y - FINGER_LIFT, root);
    const w = c && wordAround(c);
    if (!w) return;
    const cur = { s: { node: r.startContainer, offset: r.startOffset }, e: { node: r.endContainer, offset: r.endOffset } };
    const next = which === 'start' ? build(before(w.start, cur.e) ? w.start : cur.e, cur.e) : build(cur.s, before(cur.s, w.end) ? w.end : cur.s);
    apply(next);
  }, [rootRef, apply]);
  const beginHandle = useCallback(() => { setLive(true); touchSelectState.active = true; cb.current?.(null); }, []);
  const endHandle = useCallback(() => { setLive(false); report(st.current.range); }, [report]);

  // keep the app's selection state in step when the selection is cleared from outside (toolbar action, annotate, new page)
  const dismiss = useCallback(() => { if (st.current.range) clear(true); }, [clear]);
  return { range, live, clear, dismiss, moveHandle, beginHandle, endHandle };
}

/** Paints the selection (rects follow the text every frame, so page turns and scrolling never leave it behind) and its two handles. */
export function TouchSelectionLayer({ sel }) {
  const { range, live, moveHandle, beginHandle, endHandle, clear } = sel;
  const [rects, setRects] = useState([]);
  useEffect(() => {
    if (!range) { setRects([]); return undefined; }
    let raf = 0; let last = '';
    const tick = () => {
      const list = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      const key = list.map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`).join('|');
      if (!list.length || range.collapsed) { clear(); return; }                 // the text moved away (new page): drop the selection
      if (key !== last) { last = key; setRects(list.map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [range, clear]);
  if (!range || !rects.length) return null;

  const first = rects[0]; const lastR = rects[rects.length - 1];
  const handle = (which, x, y) => (
    <span className={`ts-handle ${which}`} style={{ left: x, top: y }} role="slider" aria-label={`Adjust selection ${which}`}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); beginHandle(); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) moveHandle(which, e.clientX, e.clientY); }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); endHandle(); }}
      onPointerCancel={endHandle} />
  );
  return (
    <div className="ts-layer" aria-hidden={live}>
      {rects.map((r, i) => <i key={i} className="ts-rect" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />)}
      {handle('start', first.left, first.top + first.height)}
      {handle('end', lastR.left + lastR.width, lastR.top + lastR.height)}
    </div>
  );
}
