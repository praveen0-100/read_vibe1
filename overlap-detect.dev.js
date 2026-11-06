// TEMPORARY dev helper (deleted when the overlap audit is done): finds elements whose boxes collide.
const SEL = 'button,a[href],input,select,textarea,h1,h2,h3,h4,p,img,[role=button],label,.chip,.mini-cover,.book-cover,.status-pill,kbd';
const pos = (win, e) => win.getComputedStyle(e).position;
const isLayer = (win, e) => { const p = pos(win, e); return p === 'fixed' || p === 'sticky'; };
const name = (e) => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (e.innerText || e.getAttribute('aria-label') || e.alt || '').trim().replace(/\s+/g, ' ').slice(0, 26) + '"');
const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

function layerOf(win, doc, e) { for (let n = e; n && n !== doc.body; n = n.parentElement) if (isLayer(win, n)) return n; return null; }
function clipped(win, doc, e) {
  const b = e.getBoundingClientRect();
  for (let n = e.parentElement; n && n !== doc.body; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (/(hidden|auto|scroll)/.test(cs.overflowX + cs.overflowY)) { const r = n.getBoundingClientRect(); if (b.right < r.left + 1 || b.left > r.right - 1 || b.bottom < r.top + 1 || b.top > r.bottom - 1) return true; }
  }
  return false;
}
// paged-reader page text (CSS columns: a paragraph that spans two pages has a box covering both) and flip snapshots
// The part of the element that is really on screen: its box intersected with every scrolling/clipping ancestor.
function shown(win, doc, e) {
  let r = e.getBoundingClientRect(); let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let n = e.parentElement; n && n !== doc.body; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) { const c = n.getBoundingClientRect(); box = { left: Math.max(box.left, c.left), top: Math.max(box.top, c.top), right: Math.min(box.right, c.right), bottom: Math.min(box.bottom, c.bottom) }; }
  }
  if (box.right - box.left < 6 || box.bottom - box.top < 6) return null;
  return { ...box, width: box.right - box.left, height: box.bottom - box.top };
}

function visible(win, e) {
  if (e.closest('.mr-flow, .mr-face, .mr-leafhost')) return false;
  const det = e.closest('details:not([open])'); if (det && !e.closest('summary')) return false; // content of a closed disclosure is not shown
 const r = e.getBoundingClientRect(); const cs = win.getComputedStyle(e); return r.width >= 6 && r.height >= 6 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity >= 0.05; }

// Is any part of the element actually on top at its own sample points? (Something hidden under an opaque sheet can't collide visibly.)
function onTop(doc, e, r) {
  const win = doc.defaultView;
  const pts = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
  let tested = 0;
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) continue; // off-screen: cannot be tested, treat as visible
    tested++;
    const top = doc.elementFromPoint(x, y);
    if (top && (e.contains(top) || top.contains(e))) return true;
  }
  return tested === 0;
}

export function detect(doc, { scrollBottom = false } = {}) {
  const win = doc.defaultView; const vw = win.innerWidth;
  const scroller = doc.getElementById('main');
  if (scrollBottom) { if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) scroller.scrollTop = scroller.scrollHeight; else win.scrollTo(0, doc.documentElement.scrollHeight); }
  const items = [];
  doc.querySelectorAll(SEL).forEach((e) => {
    if (!visible(win, e) || (e.closest('[aria-hidden="true"]') && !e.closest('.mr-bar')) || clipped(win, doc, e)) return;
    const r = shown(win, doc, e);
    if (r && onTop(doc, e, r)) items.push({ e, r, layer: layerOf(win, doc, e) });
  });
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.layer !== b.layer || a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const p = inter(a.r, b.r); const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    if (p < 30 || p / small < 0.12) continue;
    out.push(`${name(a.e)}  ⟂  ${name(b.e)}  (${Math.round(100 * p / small)}%)`);
  }
  const overflowX = doc.documentElement.scrollWidth > vw + 1 ? doc.documentElement.scrollWidth - vw : 0;
  return { vw, overlaps: out.slice(0, 12), more: Math.max(0, out.length - 12), overflowX };
}

/** Fixed/sticky bars against each other, and against page content with the page scrolled to its END. */
export async function detectLayers(doc) {
  const win = doc.defaultView; const vw = win.innerWidth, vh = win.innerHeight;
  const roots = [...doc.querySelectorAll('body *')].filter((e) => {
    if (!isLayer(win, e) || !visible(win, e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width >= vw * 0.97 && r.height >= vh * 0.9) return false; // full-screen overlays are meant to cover
    for (let n = e.parentElement; n && n !== doc.body; n = n.parentElement) if (isLayer(win, n)) return false;
    return r.bottom > 0 && r.top < vh;
  });
  const report = { layers: roots.map(name), layerVsLayer: [], coversContent: [] };
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
    const p = inter(roots[i].getBoundingClientRect(), roots[j].getBoundingClientRect());
    if (p > 16) report.layerVsLayer.push(`${name(roots[i])}  ⟂  ${name(roots[j])}  (${Math.round(p)}px²)`);
  }
  const scroller = doc.getElementById('main'); const can = scroller && scroller.scrollHeight > scroller.clientHeight + 4;
  if (can) scroller.scrollTop = scroller.scrollHeight; else win.scrollTo(0, doc.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 500));
  for (const e of doc.querySelectorAll(SEL)) {
    if (roots.some((r) => r.contains(e)) || !visible(win, e) || e.closest('[aria-hidden="true"], .menu, [hidden]') || clipped(win, doc, e)) continue;
    const r = shown(win, doc, e); if (!r || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    for (const root of roots) { const p = inter(r, root.getBoundingClientRect()); if (p > 40 && p / (r.width * r.height) > 0.2) report.coversContent.push(`${name(e)}  ⟂  ${name(root)}  (${Math.round(100 * p / (r.width * r.height))}% hidden)`); }
  }
  report.coversContent = report.coversContent.slice(0, 8);
  return report;
}

export async function open(path, width, height = 760, wait = 3800, setup, scale = 1) {
  document.body.innerHTML = ''; document.body.style.cssText = 'margin:0;background:#222;overflow:hidden';
  const wrap = document.createElement('div'); wrap.style.cssText = `width:${width * scale}px;height:${height * scale}px;margin:0 auto;overflow:hidden`;
  const f = document.createElement('iframe'); f.style.cssText = `width:${width}px;height:${height}px;border:0;background:#000;transform:scale(${scale});transform-origin:0 0`; f.src = path;
  wrap.append(f); document.body.append(wrap);
  await new Promise((r) => setTimeout(r, wait));
  if (setup) { await setup(f.contentDocument, f.contentWindow); await new Promise((r) => setTimeout(r, 700)); }
  return f;
}

export async function audit(path, widths, { height = 760, wait = 3600, setup } = {}) {
  const out = {};
  for (const w of widths) {
    const f = await open(path, w, height, wait, setup);
    const a = detect(f.contentDocument); const b = await detectLayers(f.contentDocument);
    out[w] = { overlaps: a.overlaps, more: a.more, overflowX: a.overflowX, layerVsLayer: b.layerVsLayer, coversEnd: b.coversContent };
  }
  return out;
}

// ── setups for the paged phone reader
export const chrome = async (d, w) => { d.querySelector('.mr-page').dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: w.innerWidth / 2, clientY: 30 })); await new Promise((r) => setTimeout(r, 500)); };
export const click = (sel) => async (d, w) => { await chrome(d, w); d.querySelector(sel)?.click(); await new Promise((r) => setTimeout(r, 500)); };
export const READER = '/read/286337c8267242f3a9997ae0e45d85ab?chapter=1';
export const run = async (url, widths, cases, height = 760) => {
  const out = {};
  for (const [k, s] of Object.entries(cases)) for (const w of widths) {
    const f = await open(url, w, height, 3200, s); const a = detect(f.contentDocument);
    (out[k] ||= {})[w] = a.overlaps.concat(a.overflowX ? ['overflowX ' + a.overflowX] : []);
  }
  return out;
};
