// ─── Page curl ───────────────────────────────────────────────────────────────
// A real paper page does not swing like a door: the corner you hold lifts, the page folds over along a line, and the folded part
// lies back down showing the reverse of the paper. That is exactly what is drawn here.
//
//   • the corner C of the page is pulled to the finger P; the fold line is the perpendicular bisector of C→P
//   • the part of the page on the spine side of the fold stays (clipped with a polygon)
//   • the part on the far side is mirrored across the fold line (one reflection matrix) and drawn as the back of the paper
//   • a crease shade on the page that stays, a highlight/shade gradient on the flap (it is curved), and a cast shadow on the
//     page being uncovered are all computed from the same fold line every frame, so the light always agrees with the shape
//
// `s` is the turn's progress: 0 = flat, 1 = completely turned away. The same code draws turning forward and backward.

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
export const easeOut = (t) => 1 - (1 - t) ** 3;

const SPAN = 2.3;      // how many page-widths the held corner travels between flat (s = 0) and gone (s = 1)
const LIFT = 0.15;     // how far (as a fraction of the page height) the held corner rises while it travels

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Part of a convex polygon where sign·dot(p − m, n) ≥ 0 (Sutherland–Hodgman against one half-plane). */
export function clipHalfPlane(poly, m, n, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = sign * dot([a[0] - m[0], a[1] - m[1]], n);
    const db = sign * dot([b[0] - m[0], b[1] - m[1]], n);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Where the held corner is for progress `s` (before any finger offset). */
export function cornerAt(s, W, H, cornerY = H) {
  const sgn = cornerY > H / 2 ? -1 : 1;
  return [W - SPAN * W * s, cornerY + sgn * H * LIFT * Math.sin(Math.PI * s)];
}

/**
 * Fold geometry for the corner C pulled to P over a W×H page, or null when the page is still flat.
 * `reflect` is the CSS matrix() that mirrors the far part across the fold.
 */
export function foldGeometry(C, P, W, H) {
  const d = [P[0] - C[0], P[1] - C[1]];
  const len = Math.hypot(d[0], d[1]);
  if (len < 1.5) return null;
  const n = [d[0] / len, d[1] / len];         // points from C toward P, i.e. toward the side of the page that stays
  const m = [(C[0] + P[0]) / 2, (C[1] + P[1]) / 2];
  const rect = [[0, 0], [W, 0], [W, H], [0, H]];
  const k = 2 * dot(m, n);
  return {
    n, m,
    stay: clipHalfPlane(rect, m, n, 1),
    fold: clipHalfPlane(rect, m, n, -1),
    reflect: [1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[1], 1 - 2 * n[1] * n[1], k * n[0], k * n[1]],
  };
}

const make = (tag, cls) => {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
};

const polygon = (pts) => `polygon(${pts.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(', ')})`;

/** A CSS gradient whose stops are measured in px from the fold line, running in direction g (a unit vector). */
function gradientFrom(m, g, W, H, stops) {
  const L = Math.abs(W * g[0]) + Math.abs(H * g[1]);
  const t0 = dot([m[0] - W / 2, m[1] - H / 2], g) + L / 2;
  const ang = (Math.atan2(g[0], -g[1]) * 180) / Math.PI;
  return `linear-gradient(${ang.toFixed(2)}deg, ${stops.map(([o, c]) => `${c} ${(t0 + o).toFixed(1)}px`).join(', ')})`;
}

/**
 * @param host     positioned element covering the page area
 * @param face     snapshot of the page that is being turned
 * @param under    (optional) snapshot of the page that lies beneath, when the live reader cannot be it
 * @param cornerY  height of the corner that is held (the bottom corner by default)
 */
export function createCurl({ host, face, under, cornerY }) {
  const W = host.clientWidth || 1;
  const H = host.clientHeight || 1;
  const cy = cornerY ?? H;
  const C = [W, cy];
  host.textContent = '';
  host.classList.add('flipping');

  const root = make('div', 'mr-curl');
  const ushade = make('i', 'mr-curl-ushade');
  const stay = make('div', 'mr-curl-stay');
  const crease = make('i', 'mr-curl-crease');
  const flap = make('div', 'mr-curl-flap');
  const back = make('div', 'mr-curl-back');       // the reverse of the paper: the page's own print showing faintly through, mirrored by the flap's matrix
  const edge = make('i', 'mr-curl-edge');         // the thin bright edge of the paper along the fold
  back.append(face.cloneNode(true));
  flap.append(back, edge);
  stay.append(face, crease);
  if (under) root.append(under);
  root.append(ushade, stay, flap);
  host.append(root);

  let raf = 0;
  let dead = false;
  let s = 0;

  const draw = (P) => {
    const g = foldGeometry(C, P, W, H);
    if (!g) {
      stay.style.clipPath = 'none'; stay.style.visibility = 'visible';
      flap.style.display = 'none'; ushade.style.display = 'none'; crease.style.display = 'none';
      return;
    }
    const { n, m } = g;
    const toFold = [-n[0], -n[1]];             // direction from the fold into the part that is folded over
    crease.style.display = 'block';
    crease.style.background = gradientFrom(m, n, W, H, [[0, 'rgba(0,0,0,.3)'], [10, 'rgba(0,0,0,.14)'], [44, 'rgba(0,0,0,0)']]);
    if (g.stay.length < 3) stay.style.visibility = 'hidden';
    else { stay.style.visibility = 'visible'; stay.style.clipPath = polygon(g.stay); }
    if (g.fold.length < 3) { flap.style.display = 'none'; ushade.style.display = 'none'; return; }
    flap.style.display = 'block';
    flap.style.clipPath = polygon(g.fold);
    flap.style.transform = `matrix(${g.reflect.map((v) => v.toFixed(5)).join(',')})`;
    // the folded paper is curved near the crease: a dark band, then a bright roll, then flat
    // (gradients live in the flap's own unmirrored space; the matrix turns them around with the paper)
    flap.style.backgroundImage = gradientFrom(m, toFold, W, H, [[0, 'rgba(0,0,0,.42)'], [5, 'rgba(255,255,255,.34)'], [18, 'rgba(255,255,255,.22)'], [44, 'rgba(0,0,0,.12)'], [78, 'rgba(255,255,255,.07)'], [140, 'rgba(0,0,0,0)']]);
    // the bright paper edge exactly on the fold
    edge.style.background = gradientFrom(m, toFold, W, H, [[0, 'rgba(255,255,255,.65)'], [1.6, 'rgba(255,255,255,0)']]);
    // the shadow the curl throws on the page it uncovers
    ushade.style.display = 'block';
    ushade.style.clipPath = polygon(g.fold);
    ushade.style.background = gradientFrom(m, toFold, W, H, [[0, 'rgba(0,0,0,.5)'], [14, 'rgba(0,0,0,.3)'], [60, 'rgba(0,0,0,.12)'], [150, 'rgba(0,0,0,0)']]);
  };

  /** Pose the page at progress `s`; `lift` is extra vertical offset from the finger (px). */
  const setS = (next, lift = 0) => {
    s = Math.max(0, Math.min(1, next));
    const [x, y] = cornerAt(s, W, H, cy);
    const top = cy > H / 2 ? H * 0.22 : 0;
    const bottom = cy > H / 2 ? H : H * 0.78;
    draw([x, Math.max(top, Math.min(bottom, y + lift))]);
  };

  /** Let go: glide to progress `to`, easing the finger's vertical offset away. */
  const settle = (to, ms, ease = easeOut, lift = 0, done) => {
    cancelAnimationFrame(raf);
    const from = s;
    const t0 = performance.now();
    const frame = (now) => {
      if (dead) return;
      const t = Math.min(1, (now - t0) / ms);
      setS(from + (to - from) * ease(t), lift * (1 - t));
      if (t < 1) raf = requestAnimationFrame(frame);
      else done?.();
    };
    raf = requestAnimationFrame(frame);
  };

  const destroy = () => {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    host.textContent = '';
    host.classList.remove('flipping');
  };

  setS(0);
  return { setS, settle, destroy, get s() { return s; }, W, H, cornerY: cy };
}

/** Snapshot of one page of a CSS-columns flow: a clipped clone translated to that page. */
export function snapshotPage(flow, pageIndex, step) {
  const face = make('div', 'mr-face');
  const clone = flow.cloneNode(true);
  clone.removeAttribute('aria-busy');
  clone.style.transition = 'none';
  clone.style.animation = 'none';
  clone.style.transform = `translate3d(${-pageIndex * step}px, 0, 0)`;
  face.append(clone);
  return face;
}
