// Browser Fullscreen API with the vendor-prefixed fallback. `supported` is false on devices that cannot fullscreen an arbitrary
// page (notably iPhone Safari) — callers then fall back to a CSS-only "book view" so the feature still works there.
import { useCallback, useEffect, useRef, useState } from 'react';

const el = () => document.documentElement;
const current = () => document.fullscreenElement || document.webkitFullscreenElement || null;

export function isFullscreenSupported() {
  return typeof document !== 'undefined' && !!(el().requestFullscreen || el().webkitRequestFullscreen) && document.fullscreenEnabled !== false;
}

export default function useFullscreen() {
  const supported = isFullscreenSupported();
  const [active, setActive] = useState(() => !!current());
  useEffect(() => {
    const sync = () => setActive(!!current());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
  }, []);

  /** Must run inside a user gesture (a click or key press), or the browser refuses. Resolves to whether it worked. */
  const enter = useCallback(async () => {
    if (!supported) return false;
    try {
      if (el().requestFullscreen) await el().requestFullscreen({ navigationUI: 'hide' }); else el().webkitRequestFullscreen();
      return true;
    } catch { return false; }
  }, [supported]);

  const exit = useCallback(async () => {
    if (!current()) return;
    try { if (document.exitFullscreen) await document.exitFullscreen(); else document.webkitExitFullscreen?.(); } catch { /* already leaving */ }
  }, []);

  const toggle = useCallback(() => (current() ? exit() : enter()), [enter, exit]);
  return { supported, active, enter, exit, toggle };
}

/**
 * "Book view": a distraction-free reading layout that follows the Fullscreen API. Entering fills the screen; leaving by any
 * route (Esc, the browser's own control, our button) also leaves book view. Without Fullscreen support it is layout-only.
 */
export function useBookView() {
  const fs = useFullscreen();
  const [bookView, setBookView] = useState(false);
  const wasFullscreen = useRef(false);

  const enter = useCallback(async () => { setBookView(true); await fs.enter(); }, [fs.enter]); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = useCallback(async () => { setBookView(false); await fs.exit(); }, [fs.exit]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback(() => (bookView ? exit() : enter()), [bookView, enter, exit]);

  // the user left fullscreen by Esc / the browser UI: leave book view too (only once we've actually been in fullscreen)
  useEffect(() => {
    if (fs.active) wasFullscreen.current = true;
    else if (wasFullscreen.current) { wasFullscreen.current = false; setBookView(false); }
  }, [fs.active]);

  // layout hook for CSS; always cleaned up so leaving the reader can never leave the app chrome hidden
  useEffect(() => {
    document.body.classList.toggle('rv-bookview', bookView);
    return () => document.body.classList.remove('rv-bookview');
  }, [bookView]);
  // leaving the reader page while in fullscreen should not strand the whole app in fullscreen
  useEffect(() => () => { if (current()) { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* ignore */ } } }, []);

  return { bookView, enter, exit, toggle, supported: fs.supported, fullscreen: fs.active };
}
