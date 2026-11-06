// Layout audit: paste into the page (or store in localStorage.__audit and eval it). Returns a compact list of problems at the
// current viewport size: page-level horizontal scroll, elements poking outside the viewport, and fixed/sticky elements that
// overlap each other. Used while fixing responsive layout; no effect on the app.
(() => {
  const vw = innerWidth; const vh = innerHeight; const out = [];
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) out.push(`PAGE-HSCROLL ${de.scrollWidth}>${vw}`);
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const clippedByAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 2 && pr.left >= -2) return true; }
    }
    return false;
  };
  const seen = new Set();
  document.body.querySelectorAll('*').forEach((el) => {
    if (out.length > 14 || !visible(el)) return;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 2 || r.left < -2) && !clippedByAncestor(el) && getComputedStyle(el).position !== 'absolute') {
      const n = name(el); if (!seen.has(n)) { seen.add(n); out.push(`OUTSIDE ${n} ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`); }
    }
  });
  // fixed / sticky chrome that overlaps other fixed chrome, or is cut off by the viewport
  const fixed = [...document.body.querySelectorAll('*')].filter((el) => { const p = getComputedStyle(el).position; return (p === 'fixed') && visible(el) && el.getBoundingClientRect().width < vw * 0.98; });
  fixed.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom > vh + 2 || r.right > vw + 2) out.push(`CUT-OFF ${name(el)} b${Math.round(r.bottom)}/${vh} r${Math.round(r.right)}/${vw}`);
  });
  for (let i = 0; i < fixed.length; i += 1) {
    for (let j = i + 1; j < fixed.length; j += 1) {
      const a = fixed[i]; const b = fixed[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left); const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 6 && h > 6) out.push(`OVERLAP ${name(a)} x ${name(b)} (${Math.round(w)}x${Math.round(h)})`);
    }
  }
  return `${vw}x${vh} ${out.length ? out.join(' | ') : 'OK'}`;
})();
