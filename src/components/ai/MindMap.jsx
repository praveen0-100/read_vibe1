// Interactive mind map: collapsible tree with pan/zoom, node details and export.
import React, { useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Download, Image as ImageIcon } from 'lucide-react';
import { exportPng, exportSvg } from '../../lib/svgExport';
import ZoomableSvg, { wrap } from './ZoomableSvg';

const COL = 210;
const ROW = 46;
const NODE_W = 172;
const PALETTE = ['var(--accent)', 'var(--purple)', 'var(--blue)', 'var(--green)', 'var(--amber)'];

function layout(root, collapsed) {
  const nodes = [];
  const links = [];
  let row = 0;
  const walk = (node, depth, color, parent) => {
    const kids = collapsed.has(node.id) ? [] : node.children || [];
    const entry = { ...node, depth, color, hasChildren: (node.children || []).length > 0, collapsed: collapsed.has(node.id) };
    if (kids.length === 0) {
      entry.y = row * ROW;
      row += Math.max(1, wrap(node.label, 22, 2).length * 0.75);
    } else {
      const ys = kids.map((k, i) => walk(k, depth + 1, depth === 0 ? PALETTE[i % PALETTE.length] : color, entry));
      entry.y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    entry.x = depth * COL;
    nodes.push(entry);
    if (parent) links.push({ from: parent, to: entry });
    return entry.y;
  };
  walk(root, 0, 'var(--accent)', null);
  return { nodes, links, height: Math.max(row * ROW, ROW) };
}

export default function MindMap({ data, title, onSave, onOpenChapter }) {
  const svgRef = useRef(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const { nodes, links, height } = useMemo(() => layout(data.root, collapsed), [data, collapsed]);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const W = (maxDepth + 1) * COL + 40;
  const H = height + 60;

  // Links reference parent entries; patch positions after layout
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const toggle = (n) => {
    setSelected(n.id === selected?.id ? null : n);
    if (!n.hasChildren) return;
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(n.id) ? next.delete(n.id) : next.add(n.id);
      return next;
    });
  };
  const allIds = [];
  const collect = (n) => { if (n.children?.length) { allIds.push(n.id); n.children.forEach(collect); } };
  collect(data.root);

  return (
    <div className="viz">
      <div className="viz-toolbar">
        <button className="chip" onClick={() => setCollapsed(new Set())}><ChevronsUpDown size={13} /> Expand all</button>
        <button className="chip" onClick={() => setCollapsed(new Set(allIds.filter((id) => id !== 'root')))}><ChevronsDownUp size={13} /> Collapse</button>
        <span className="grow" />
        <button className="chip" onClick={() => exportPng(svgRef.current, `${title}-mindmap`)}><ImageIcon size={13} /> PNG</button>
        <button className="chip" onClick={() => exportSvg(svgRef.current, `${title}-mindmap`)}><Download size={13} /> SVG</button>
      </div>
      <ZoomableSvg ref={svgRef} width={W} height={H} label={`Mind map of ${title}`} minHeight={360}>
        <g transform="translate(20 30)">
          {links.map(({ from, to }) => {
            const a = byId[from.id] || from;
            const b = byId[to.id] || to;
            const x1 = a.x + NODE_W;
            const x2 = b.x;
            const mx = (x1 + x2) / 2;
            return <path key={`${a.id}-${b.id}`} d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`} fill="none" stroke={b.color} strokeOpacity="0.55" strokeWidth={b.depth === 1 ? 2.2 : 1.4} />;
          })}
          {nodes.map((n) => {
            const lines = wrap(n.label, n.depth === 0 ? 20 : 24, 2);
            const h = 16 + lines.length * 14;
            const isSel = selected?.id === n.id;
            return (
              <g key={n.id} data-node transform={`translate(${n.x} ${n.y - h / 2})`} className="mm-node" role="button" tabIndex={0}
                aria-label={`${n.label}${n.hasChildren ? (n.collapsed ? ', collapsed' : ', expanded') : ''}`}
                onClick={() => toggle(n)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(n))}>
                <rect width={NODE_W} height={h} rx={n.depth === 0 ? 12 : 9}
                  fill={n.depth === 0 ? n.color : 'var(--panel-2)'} stroke={isSel ? 'var(--text)' : n.color} strokeWidth={isSel ? 2 : n.depth === 1 ? 1.6 : 1} />
                {lines.map((l, i) => (
                  <text key={i} x={12} y={20 + i * 14} fontSize={n.depth === 0 ? 12.5 : 11.5} fontWeight={n.depth <= 1 ? 600 : 400}
                    fill={n.depth === 0 ? '#1d120d' : 'var(--text)'}>{l}</text>
                ))}
                {n.hasChildren && n.depth > 0 && (
                  <g transform={`translate(${NODE_W - 4} ${h / 2})`}>
                    <circle r={8} fill="var(--panel)" stroke={n.color} />
                    <text textAnchor="middle" y={4} fontSize={11} fill={n.color}>{n.collapsed ? '+' : '–'}</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </ZoomableSvg>
      {selected && (
        <div className="viz-detail">
          <strong>{selected.label}</strong>
          <p>{selected.detail || (selected.hasChildren ? `${(selected.children || []).length} related ideas — click to expand or collapse.` : 'No definition found in the text for this idea.')}</p>
          {selected.chapter_index != null && onOpenChapter && (
            <button className="text-button" onClick={() => onOpenChapter(selected.chapter_index)}>Open in reader →</button>
          )}
        </div>
      )}
      {onSave && <button className="secondary-button full" onClick={onSave}>Save mind map to notebook</button>}
    </div>
  );
}
