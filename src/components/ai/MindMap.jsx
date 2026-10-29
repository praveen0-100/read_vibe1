// Interactive mind map: the topic sits in the centre and its branches fan out to both sides as
// cards (title + one-line hint), colour-coded by group. Click a card to open its sub-ideas.
import React, { useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Download, Image as ImageIcon } from 'lucide-react';
import { exportPng, exportSvg } from '../../lib/svgExport';
import ZoomableSvg, { wrap } from './ZoomableSvg';

const CENTER_W = 190;
const CENTER_GAP = 72;
const CARD_W = 196;
const CHILD_GAP = 38;
const CHILD_W = 172;
const CHILD_H = 30;
const CHILD_SPACE = 6;
const ROW_GAP = 16;
const PAD = 28;
const CORE = 'var(--green)';
const PRACTICE = 'var(--accent)';

/** One-line hint under a branch title: its definition's opening clause, else its sub-ideas. */
function hintFor(node) {
  const kids = (node.children || []).map((c) => c.label);
  const source = node.detail ? node.detail.split(/[.;:]/)[0] : kids.slice(0, 3).join(', ');
  return wrap(source.trim(), 30, 1)[0] || '';
}

function layout(root, expanded) {
  const branches = root.children || [];
  const split = Math.ceil(branches.length / 2); // the strongest half goes left ("core"), the rest right
  const sides = [
    { dir: -1, group: 0, items: branches.slice(0, split) },
    { dir: 1, group: 1, items: branches.slice(split) },
  ];
  const measured = sides.map((side) => {
    let total = 0;
    const rows = side.items.map((b) => {
      const titleLines = wrap(b.label, 22, 2);
      const hint = hintFor(b);
      const h = 22 + titleLines.length * 15 + (hint ? 16 : 0);
      const open = expanded.has(b.id) && (b.children || []).length > 0;
      const kidsH = open ? b.children.length * (CHILD_H + CHILD_SPACE) - CHILD_SPACE : 0;
      const block = Math.max(h, kidsH);
      const row = { branch: b, titleLines, hint, h, open, block, top: total };
      total += block + ROW_GAP;
      return row;
    });
    return { ...side, rows, total: Math.max(total - ROW_GAP, 0), anyOpen: rows.some((r) => r.open) };
  });
  const innerH = Math.max(...measured.map((s) => s.total), 120);
  const reach = (s) => CENTER_GAP + CARD_W + (s.anyOpen ? CHILD_GAP + CHILD_W : 0);
  const left = reach(measured[0]);
  const cx = PAD + left + CENTER_W / 2;
  const cy = PAD + innerH / 2;
  const width = cx + CENTER_W / 2 + reach(measured[1]) + PAD;

  const cards = [];
  const kids = [];
  measured.forEach((side) => {
    const y0 = cy - side.total / 2;
    side.rows.forEach((r) => {
      const y = y0 + r.top + r.block / 2;
      const color = side.group === 0 ? CORE : PRACTICE;
      const x = side.dir < 0 ? cx - CENTER_W / 2 - CENTER_GAP - CARD_W : cx + CENTER_W / 2 + CENTER_GAP;
      cards.push({ ...r, x, y, color, dir: side.dir });
      if (r.open) {
        const stackH = r.branch.children.length * (CHILD_H + CHILD_SPACE) - CHILD_SPACE;
        r.branch.children.forEach((c, i) => {
          const kx = side.dir < 0 ? x - CHILD_GAP - CHILD_W : x + CARD_W + CHILD_GAP;
          kids.push({ node: c, parent: cards[cards.length - 1], x: kx, y: y - stackH / 2 + i * (CHILD_H + CHILD_SPACE) + CHILD_H / 2, color, dir: side.dir });
        });
      }
    });
  });
  return { cards, kids, cx, cy, width, height: innerH + PAD * 2, count: branches.length };
}

// Smooth S-curve between two points, leaving horizontally
const curve = (x1, y1, x2, y2) => {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

export default function MindMap({ data, title, onSave, onOpenChapter }) {
  const svgRef = useRef(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const root = data.root;
  const { cards, kids, cx, cy, width, height, count } = useMemo(() => layout(root, expanded), [root, expanded]);
  const byChapter = (root.children || []).some((b) => String(b.id).startsWith('c'));
  const legend = byChapter ? ['Opening chapters', 'Later chapters'] : ['Core ideas', 'Supporting ideas'];
  const expandable = (root.children || []).filter((b) => (b.children || []).length > 0).map((b) => b.id);

  const pick = (node, hasKids) => {
    setSelected((s) => (s?.id === node.id ? null : node));
    if (!hasKids) return;
    setExpanded((s) => {
      const next = new Set(s);
      next.has(node.id) ? next.delete(node.id) : next.add(node.id);
      return next;
    });
  };
  const keyHandler = (fn) => (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn());
  const rootLines = wrap(root.label, 20, 3);
  const rootH = 26 + rootLines.length * 16;

  return (
    <div className="viz">
      <div className="viz-toolbar">
        <button className="chip" onClick={() => setExpanded(new Set(expandable))}><ChevronsUpDown size={13} /> Expand all</button>
        <button className="chip" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={13} /> Collapse</button>
        <span className="grow" />
        <button className="chip" onClick={() => exportPng(svgRef.current, `${title}-mindmap`)}><ImageIcon size={13} /> PNG</button>
        <button className="chip" onClick={() => exportSvg(svgRef.current, `${title}-mindmap`)}><Download size={13} /> SVG</button>
      </div>
      <ZoomableSvg ref={svgRef} width={width} height={height + 34} label={`Mind map of ${title}`} minHeight={320}>
        {/* connectors first so cards sit on top */}
        {cards.map((c) => {
          const edge = c.dir < 0 ? c.x + CARD_W : c.x;
          const from = cx + (c.dir < 0 ? -CENTER_W / 2 : CENTER_W / 2);
          return <path key={`l-${c.branch.id}`} d={curve(from, cy, edge, c.y)} fill="none" stroke={c.color} strokeOpacity="0.6" strokeWidth="1.8" />;
        })}
        {kids.map((k) => {
          const from = k.dir < 0 ? k.parent.x : k.parent.x + CARD_W;
          const to = k.dir < 0 ? k.x + CHILD_W : k.x;
          return <path key={`k-${k.node.id}`} d={curve(from, k.parent.y, to, k.y)} fill="none" stroke={k.color} strokeOpacity="0.45" strokeWidth="1.3" />;
        })}

        <g data-node className="mm-node" role="button" tabIndex={0} aria-label={`${root.label}, central topic`}
          transform={`translate(${cx - CENTER_W / 2} ${cy - rootH / 2})`}
          onClick={() => setSelected((s) => (s?.id === root.id ? null : root))} onKeyDown={keyHandler(() => setSelected(root))}>
          <rect width={CENTER_W} height={rootH} rx={10} fill="var(--panel)" />
          <rect width={CENTER_W} height={rootH} rx={10} fill="var(--purple)" fillOpacity="0.28" stroke="var(--purple)" strokeWidth={selected?.id === root.id ? 2.4 : 1.4} />
          {rootLines.map((l, i) => (
            <text key={i} x={CENTER_W / 2} y={24 + i * 16} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)">{l}</text>
          ))}
        </g>

        {cards.map((c) => {
          const b = c.branch;
          const n = (b.children || []).length;
          const isSel = selected?.id === b.id;
          return (
            <g key={b.id} data-node className="mm-node" role="button" tabIndex={0} transform={`translate(${c.x} ${c.y - c.h / 2})`}
              aria-label={`${b.label}${n ? (c.open ? ', expanded' : ', collapsed') : ''}`}
              onClick={() => pick(b, n > 0)} onKeyDown={keyHandler(() => pick(b, n > 0))}>
              <rect width={CARD_W} height={c.h} rx={9} fill="var(--panel)" />
              <rect width={CARD_W} height={c.h} rx={9} fill={c.color} fillOpacity="0.18" stroke={c.color} strokeWidth={isSel ? 2.4 : 1.3} />
              {c.titleLines.map((l, i) => (
                <text key={i} x={CARD_W / 2} y={21 + i * 15} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text)">{l}</text>
              ))}
              {c.hint && <text x={CARD_W / 2} y={21 + c.titleLines.length * 15 + 2} textAnchor="middle" fontSize="10.5" fill={c.color}>{c.hint}</text>}
              {n > 0 && (
                <g transform={`translate(${c.dir < 0 ? 0 : CARD_W} ${c.h / 2})`}>
                  <circle r={9} fill="var(--panel)" stroke={c.color} />
                  <text textAnchor="middle" y={4} fontSize="11" fill={c.color}>{c.open ? '–' : n}</text>
                </g>
              )}
            </g>
          );
        })}

        {kids.map((k) => {
          const lines = wrap(k.node.label, 26, 1);
          const isSel = selected?.id === k.node.id;
          return (
            <g key={k.node.id} data-node className="mm-node" role="button" tabIndex={0} transform={`translate(${k.x} ${k.y - CHILD_H / 2})`}
              aria-label={k.node.label} onClick={() => pick(k.node, false)} onKeyDown={keyHandler(() => pick(k.node, false))}>
              <rect width={CHILD_W} height={CHILD_H} rx={CHILD_H / 2} fill="var(--panel)" />
              <rect width={CHILD_W} height={CHILD_H} rx={CHILD_H / 2} fill={k.color} fillOpacity="0.1" stroke={k.color} strokeOpacity="0.8" strokeWidth={isSel ? 2 : 1} />
              <text x={CHILD_W / 2} y={CHILD_H / 2 + 4} textAnchor="middle" fontSize="11" fill="var(--text)">{lines[0]}</text>
            </g>
          );
        })}

        {/* legend */}
        <g transform={`translate(${cx - (count > 1 ? 120 : 50)} ${height + 4})`} fontSize="11" fill="var(--text-2)">
          <rect y={-9} width="11" height="11" rx="3" fill={CORE} fillOpacity="0.5" stroke={CORE} />
          <text x={18} y={0}>{legend[0]}</text>
          {count > 1 && (
            <>
              <rect x={130} y={-9} width="11" height="11" rx="3" fill={PRACTICE} fillOpacity="0.5" stroke={PRACTICE} />
              <text x={148} y={0}>{legend[1]}</text>
            </>
          )}
        </g>
      </ZoomableSvg>
      {selected && (
        <div className="viz-detail">
          <strong>{selected.label}</strong>
          <p>{selected.detail || ((selected.children || []).length ? `${selected.children.length} related ideas — click the card to open or close them.` : 'No definition found in the text for this idea.')}</p>
          {selected.chapter_index != null && onOpenChapter && (
            <button className="text-button" onClick={() => onOpenChapter(selected.chapter_index)}>Open in reader →</button>
          )}
        </div>
      )}
      {onSave && <button className="secondary-button full" onClick={onSave}>Save mind map to notebook</button>}
    </div>
  );
}
