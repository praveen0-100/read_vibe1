// Slideshow state: which slide, how many of its builds are revealed, and — across the presenter and audience windows —
// the same position, captions, blackout and laser pointer, synced over a BroadcastChannel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { buildCount } from '../lib/deckThemes';

/** True when the user (or their OS) asked for less motion. */
export function useReducedMotion() {
  const { prefs } = useApp();
  const [os, setOs] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const on = () => setOs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return os || !!prefs.accessibility.reducedMotion;
}

export function useDeckPlayer(slides, { channel: channelName = null, builds: buildsOn = true } = {}) {
  const [pos, setPos] = useState({ index: 0, step: 0 });
  const [builds, setBuilds] = useState(buildsOn);
  const [blackout, setBlackout] = useState(false);
  const [laser, setLaser] = useState(null); // {x, y} in 0..1 of the stage, or null
  const [caption, setCaption] = useState('');
  const chan = useRef(null);
  const lastRemote = useRef(null); // the last position another window told us about, so we never echo it back
  const total = slides.length;

  const stepFor = useCallback((i, atEnd) => (builds && slides[i] ? (atEnd ? buildCount(slides[i]) : 0) : Infinity), [builds, slides]);
  const goto = useCallback((i, atEnd = true) => { // a jump lands on the finished slide, not its empty first build
    const index = Math.max(0, Math.min(total - 1, i));
    setPos({ index, step: stepFor(index, atEnd) });
  }, [total, stepFor]);

  const next = useCallback(() => setPos((p) => {
    const slide = slides[p.index];
    if (builds && slide && p.step !== Infinity && p.step < buildCount(slide)) return { ...p, step: p.step + 1 };
    if (p.index >= total - 1) return p;
    return { index: p.index + 1, step: stepFor(p.index + 1, false) };
  }), [slides, builds, total, stepFor]);

  const prev = useCallback(() => setPos((p) => {
    if (builds && p.step !== Infinity && p.step > 0) return { ...p, step: p.step - 1 };
    if (p.index <= 0) return p;
    return { index: p.index - 1, step: stepFor(p.index - 1, true) };
  }), [builds, total, stepFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // turning builds off reveals everything; on, it starts the current slide from its first build
  useEffect(() => { setPos((p) => ({ ...p, step: builds ? 0 : Infinity })); }, [builds]);
  // a deck that shrinks (slide deleted while presenting) must not leave us past the end
  useEffect(() => { setPos((p) => (p.index >= total && total > 0 ? { index: total - 1, step: stepFor(total - 1, true) } : p)); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync between windows ───────────────────────────────────────────────────
  useEffect(() => {
    if (!channelName || typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel(channelName);
    chan.current = ch;
    ch.onmessage = ({ data: m }) => {
      if (m.type === 'pos') { lastRemote.current = { index: m.index, step: m.step === null ? Infinity : m.step }; setPos(lastRemote.current); }
      else if (m.type === 'builds') setBuilds(m.on);
      else if (m.type === 'blackout') setBlackout(m.on);
      else if (m.type === 'laser') setLaser(m.at);
      else if (m.type === 'caption') setCaption(m.text);
      else if (m.type === 'hello') ch.postMessage({ type: 'pos', index: posRef.current.index, step: posRef.current.step === Infinity ? null : posRef.current.step });
    };
    ch.postMessage({ type: 'hello' }); // a window that opens late asks the others where we are
    return () => { ch.close(); chan.current = null; };
  }, [channelName]);

  const posRef = useRef(pos);
  posRef.current = pos;
  const send = (m) => chan.current?.postMessage(m);

  useEffect(() => {
    const r = lastRemote.current;
    lastRemote.current = null;
    if (r && r.index === pos.index && r.step === pos.step) return;
    send({ type: 'pos', index: pos.index, step: pos.step === Infinity ? null : pos.step });
  }, [pos.index, pos.step]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => ({
    setBlackout: (on) => { setBlackout(on); send({ type: 'blackout', on }); },
    setLaser: (at) => { setLaser(at); send({ type: 'laser', at }); },
    setCaption: (text) => { setCaption(text); send({ type: 'caption', text }); },
    setBuilds: (on) => { setBuilds(on); send({ type: 'builds', on }); },
  }), []);

  return { ...pos, slide: slides[pos.index], total, builds, blackout, laser, caption, goto, next, prev, ...api };
}
