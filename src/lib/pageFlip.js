// ─── Real page flip ──────────────────────────────────────────────────────────
// A paper leaf hinged on the spine (left edge) swings over in 3D. Its front is a snapshot of the page that turns; its
// back is blank paper. While it moves it darkens toward the free edge and casts a soft shadow onto the page beneath —
// everything is recomputed from the angle each frame, so the lighting always matches the leaf's position.
//
//   forward  (direction  1): the underlying page is already the NEW page; the leaf (old page) turns 0° → 180° away.
//   backward (direction -1): the underlying page is the OLD page; the leaf (the earlier page) lands 180° → 0° on top.

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

const make = (tag, cls) => {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
};

/**
 * @param host      positioned element covering the page area (receives the leaf)
 * @param face      element holding a snapshot of the page that turns
 * @returns {{finish: () => void}} finish() jumps to the end state immediately (safe to call twice)
 */
export function flipPages({ host, face, direction = 1, duration = 640, onDone }) {
  const W = host.clientWidth || 1;
  host.textContent = '';
  host.classList.add('flipping');

  const leaf = make('div', 'mr-leaf');
  const front = make('div', 'mr-leaf-front');
  const frontShade = make('i', 'mr-leaf-shade front');
  const back = make('div', 'mr-leaf-back');
  const backShade = make('i', 'mr-leaf-shade back');
  const cast = make('i', 'mr-cast');
  front.append(face, frontShade);
  back.append(backShade);
  leaf.append(front, back);
  host.append(cast, leaf);

  const start = performance.now();
  let raf = 0;
  let finished = false;

  const paint = (progress) => {
    const deg = progress * 180;
    const rad = (deg * Math.PI) / 180;
    const s = Math.sin(rad);
    leaf.style.transform = `rotateY(${-deg}deg)`;
    frontShade.style.opacity = String(deg <= 90 ? 0.55 * s : 0);
    backShade.style.opacity = String(deg > 90 ? 0.5 * s : 0);

    if (deg <= 90) {
      // shadow falls on the page to the right of the leaf's free edge
      const edge = W * Math.cos(rad);
      cast.style.left = `${edge}px`;
      cast.style.width = `${W * 0.4 * s + 6}px`;
      cast.style.opacity = String(Math.min(1, s * 1.15));
      cast.style.transform = 'none';
    } else {
      // the leaf has swung past the spine: a fading shade along the spine edge
      const k = 1 - (deg - 90) / 90;
      cast.style.left = '0px';
      cast.style.width = `${W * 0.3 * k + 6}px`;
      cast.style.opacity = String(Math.max(0, k * 0.9));
      cast.style.transform = 'none';
    }
  };

  const end = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    host.textContent = '';
    host.classList.remove('flipping');
    onDone?.();
  };

  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    paint(direction > 0 ? e : 1 - e);
    if (t < 1) raf = requestAnimationFrame(frame);
    else end();
  };

  paint(direction > 0 ? 0 : 1);
  raf = requestAnimationFrame(frame);
  return { finish: end };
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
