// SVG canvas with wheel/pinch zoom, drag-to-pan and keyboard-accessible controls.
import React, { forwardRef, useCallback, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

const ZoomableSvg = forwardRef(function ZoomableSvg({ width, height, children, label, minHeight = 320 }, svgRef) {
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  const pointers = useRef(new Map());

  const zoomBy = useCallback((factor, cx = width / 2, cy = height / 2) => {
    setT((p) => {
      const k = Math.max(0.35, Math.min(4, p.k * factor));
      const f = k / p.k;
      return { k, x: cx - (cx - p.x) * f, y: cy - (cy - p.y) * f };
    });
  }, [width, height]);

  const toSvg = (e) => {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 40 && !e.shiftKey) {
      // trackpad scroll pans
      setT((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
      return;
    }
    const pt = toSvg(e);
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, pt.x, pt.y);
  };

  const onPointerDown = (e) => {
    if (e.target.closest('[data-node]')) return; // let nodes handle clicks
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, toSvg(e));
    drag.current = { start: toSvg(e), t };
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = toSvg(e);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.current.set(e.pointerId, pt);
      const [c, d] = [...pointers.current.values()];
      const after = Math.hypot(c.x - d.x, c.y - d.y);
      if (before > 0) zoomBy(after / before, (c.x + d.x) / 2, (c.y + d.y) / 2);
      return;
    }
    pointers.current.set(e.pointerId, pt);
    if (drag.current) {
      const { start, t: t0 } = drag.current;
      setT({ ...t0, x: t0.x + (pt.x - start.x), y: t0.y + (pt.y - start.y) });
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) drag.current = null;
  };

  return (
    <div className="zoom-canvas">
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ minHeight }}
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <g data-panzoom transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>{children}</g>
      </svg>
      <div className="zoom-controls">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button onClick={() => setT({ x: 0, y: 0, k: 1 })} aria-label="Reset view"><Maximize2 size={14} /></button>
      </div>
    </div>
  );
});

export default ZoomableSvg;

/** Wrap text into lines of roughly `max` characters. */
export function wrap(text, max = 18, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = `${line} ${w}`.trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].replace(/[.,;:]?$/, '')}…`;
    return cut;
  }
  return lines;
}
