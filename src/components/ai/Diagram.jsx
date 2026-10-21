// Diagram renderer for flowcharts, concept maps and block diagrams (+ Mermaid source).
import React, { useMemo, useRef } from 'react';
import { Code2, Download, FileCode, Image as ImageIcon } from 'lucide-react';
import { exportHtml, exportPng, exportSvg } from '../../lib/svgExport';
import ZoomableSvg, { wrap } from './ZoomableSvg';

const NW = 168;
const NH = 54;

function layoutFlow(nodes, edges, layout) {
  const rank = { [nodes[0]?.id]: 0 };
  const order = [nodes[0]?.id];
  const back = new Set();
  // BFS ranking; edges pointing to an already-ranked node at a lower rank are back edges
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    edges.filter((e) => e.from === id).forEach((e) => {
      if (rank[e.to] === undefined) { rank[e.to] = rank[id] + 1; order.push(e.to); }
      else if (rank[e.to] <= rank[id]) back.add(e);
    });
  }
  nodes.forEach((n) => { if (rank[n.id] === undefined) rank[n.id] = Math.max(0, ...Object.values(rank)) + 1; });
  const byRank = {};
  nodes.forEach((n) => (byRank[rank[n.id]] ||= []).push(n.id));
  const maxCols = Math.max(...Object.values(byRank).map((r) => r.length));
  const pos = {};
  const gapMain = layout === 'LR' ? NW + 70 : NH + 52;
  const gapCross = layout === 'LR' ? NH + 40 : NW + 36;
  Object.entries(byRank).forEach(([r, ids]) => {
    const offset = ((maxCols - ids.length) * gapCross) / 2;
    ids.forEach((id, i) => {
      const main = Number(r) * gapMain;
      const cross = offset + i * gapCross;
      pos[id] = layout === 'LR' ? { x: main, y: cross } : { x: cross, y: main };
    });
  });
  const ranks = Object.keys(byRank).length;
  const size = layout === 'LR'
    ? { w: ranks * gapMain, h: maxCols * gapCross }
    : { w: maxCols * gapCross, h: ranks * gapMain };
  return { pos, back, ...size };
}

function layoutRadial(nodes) {
  const pos = {};
  const others = nodes.slice(1);
  const R = Math.max(190, others.length * 34);
  const cx = R + NW / 2 + 20;
  const cy = R * 0.75 + NH;
  pos[nodes[0].id] = { x: cx - NW / 2, y: cy - NH / 2 };
  others.forEach((n, i) => {
    const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
    pos[n.id] = { x: cx + Math.cos(a) * R - NW / 2, y: cy + Math.sin(a) * R * 0.75 - NH / 2 };
  });
  return { pos, back: new Set(), w: cx * 2, h: cy * 2 };
}

function Shape({ shape, fill, stroke }) {
  if (shape === 'diamond') return <polygon points={`${NW / 2},0 ${NW},${NH / 2} ${NW / 2},${NH} 0,${NH / 2}`} fill={fill} stroke={stroke} strokeWidth="1.4" />;
  if (shape === 'circle') return <ellipse cx={NW / 2} cy={NH / 2} rx={NW / 2} ry={NH / 2 + 4} fill={fill} stroke={stroke} strokeWidth="1.6" />;
  return <rect width={NW} height={NH} rx={shape === 'stadium' ? NH / 2 : 10} fill={fill} stroke={stroke} strokeWidth="1.4" />;
}

export default function Diagram({ data, title, onSave }) {
  const svgRef = useRef(null);
  const { nodes, edges } = data;
  const L = useMemo(
    () => (data.kind === 'flowchart' ? layoutFlow(nodes, edges, data.layout) : layoutRadial(nodes)),
    [data, nodes, edges],
  );
  const pad = 30;
  const W = L.w + pad * 2;
  const H = L.h + pad * 2;
  const center = (id) => ({ x: L.pos[id].x + NW / 2, y: L.pos[id].y + NH / 2 });

  const edgePath = (e) => {
    const a = center(e.from);
    const b = center(e.to);
    if (L.back.has(e)) {
      const off = data.layout === 'LR' ? { dx: 0, dy: -NH * 1.4 } : { dx: NW * 0.9, dy: 0 };
      return `M${a.x + (data.layout === 'LR' ? 0 : NW / 2)},${a.y + (data.layout === 'LR' ? -NH / 2 : 0)} C${a.x + off.dx + NW / 2},${a.y + off.dy} ${b.x + off.dx + NW / 2},${b.y + off.dy} ${b.x + (data.layout === 'LR' ? 0 : NW / 2)},${b.y + (data.layout === 'LR' ? -NH / 2 : 0)}`;
    }
    // clip to node border
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const clip = (p, sx, sy) => {
      const tx = Math.abs(sx) > 0 ? (NW / 2) / Math.abs(sx) : Infinity;
      const ty = Math.abs(sy) > 0 ? (NH / 2) / Math.abs(sy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: p.x + sx * t, y: p.y + sy * t };
    };
    const len = Math.hypot(dx, dy) || 1;
    const s = clip(a, dx / len, dy / len);
    const t = clip(b, -dx / len, -dy / len);
    return `M${s.x},${s.y} L${t.x},${t.y}`;
  };

  const name = `${title}-${data.kind}`;
  const copyMermaid = () => navigator.clipboard?.writeText(data.mermaid);

  return (
    <div className="viz">
      <div className="viz-toolbar">
        <button className="chip" onClick={() => exportPng(svgRef.current, name)}><ImageIcon size={13} /> PNG</button>
        <button className="chip" onClick={() => exportSvg(svgRef.current, name)}><Download size={13} /> SVG</button>
        <button className="chip" onClick={() => exportHtml(svgRef.current, name, title)}><FileCode size={13} /> HTML</button>
        <button className="chip" onClick={copyMermaid} title="Copy Mermaid source"><Code2 size={13} /> Mermaid</button>
      </div>
      <ZoomableSvg ref={svgRef} width={W} height={H} label={`${data.kind} for ${title}`} minHeight={300}>
        <defs>
          <marker id="rv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        <g transform={`translate(${pad} ${pad})`}>
          {edges.map((e, i) => {
            const a = center(e.from);
            const b = center(e.to);
            return (
              <g key={i}>
                <path d={edgePath(e)} fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray={L.back.has(e) ? '5 4' : undefined} markerEnd="url(#rv-arrow)" />
                {e.label && (
                  <text x={(a.x + b.x) / 2 + (L.back.has(e) ? NW * 0.6 : 6)} y={(a.y + b.y) / 2 - 4} fontSize="10" fill="var(--muted)" textAnchor="middle">{e.label}</text>
                )}
              </g>
            );
          })}
          {nodes.map((n, i) => {
            const p = L.pos[n.id];
            const lines = wrap(n.label, n.shape === 'diamond' ? 16 : 22, 3);
            const highlight = i === 0;
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`}>
                <Shape shape={n.shape} fill={highlight ? 'var(--accent-soft)' : 'var(--panel-2)'} stroke={highlight ? 'var(--accent)' : n.shape === 'diamond' ? 'var(--amber)' : 'var(--purple)'} />
                {lines.map((l, j) => (
                  <text key={j} x={NW / 2} y={NH / 2 + (j - (lines.length - 1) / 2) * 13 + 4} fontSize="11" textAnchor="middle" fill="var(--text)" fontWeight={highlight ? 600 : 400}>{l}</text>
                ))}
              </g>
            );
          })}
        </g>
      </ZoomableSvg>
      <details className="mermaid-src">
        <summary>Mermaid source</summary>
        <pre>{data.mermaid}</pre>
      </details>
      {onSave && <button className="secondary-button full" onClick={onSave}>Save diagram to notebook</button>}
    </div>
  );
}
