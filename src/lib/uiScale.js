// ─── Display class + scaling for very large screens ──────────────────────────
// The stylesheet is written in CSS pixels, so on 2K/4K monitors and TVs the whole interface is scaled up
// (the layout box shrinks by the same factor, so every breakpoint still sees a "normal" desktop width).
// Also tags <html data-display="phone|tablet|laptop|desktop|tv"> so CSS can target a device class.

const TV_UA = /smart-?tv|tizen|web0s|webos|netcast|hbbtv|appletv|googletv|android tv|crkey|bravia|roku|vidaa|viera|\baft[a-z]+\b/i;

export const isTV = () => typeof navigator !== 'undefined' && TV_UA.test(navigator.userAgent);

/** Interface scale for a viewport width (CSS px). 1 on everything up to a 1080p desktop. */
export function scaleFor(width, tv = isTV()) {
  let z = width >= 2200 ? Math.min(3, width / 1760) : 1;
  if (tv && width >= 1700) z = Math.max(z, 1.4); // 10-foot viewing distance
  return Math.round(z * 20) / 20;
}

export function displayClass(width, tv = isTV()) {
  if (tv) return 'tv';
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  if (width < 1440) return 'laptop';
  return 'desktop';
}

export function installUiScale() {
  const root = document.documentElement;
  const apply = () => {
    const w = window.innerWidth;
    const z = scaleFor(w);
    root.style.setProperty('--z', String(z));
    root.classList.toggle('ui-scaled', z > 1);
    root.classList.toggle('tv', isTV());
    root.dataset.display = displayClass(w);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
