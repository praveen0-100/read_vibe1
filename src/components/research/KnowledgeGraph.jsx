// Knowledge graph: concepts from the chosen documents, linked when they appear in the same paragraph.
// Click a concept to see the passages behind it; shared concepts (present in more than one source) are highlighted.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Network } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';

const W = 760;
const H = 460;

/** Deterministic force layout (no randomness, so the same graph always looks the same). */
export function layout(nodes, edges, iterations = 220) {
  const pts = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    return { id: n.id, x: W / 2 + Math.cos(a) * W * 0.32, y: H / 2 + Math.sin(a) * H * 0.32, vx: 0, vy: 0 };
  });
  const byId = new Map(pts.map((p) => [p.id, p]));
  for (let it = 0; it < iterations; it += 1) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const a = pts[i]; const b = pts[j];
        const dx = a.x - b.x; const dy = a.y - b.y;
        const d2 = Math.max(60, dx * dx + dy * dy);
        const f = (2600 / d2) * cool;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    edges.forEach((e) => {
      const a = byId.get(e.source); const b = byId.get(e.target);
      if (!a || !b) return;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - 110) * 0.012 * Math.min(3, e.weight) * cool;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    });
    pts.forEach((p) => {
      p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.002;
      p.x = Math.min(W - 40, Math.max(40, p.x + p.vx * 0.6)); p.y = Math.min(H - 24, Math.max(24, p.y + p.vy * 0.6));
      p.vx *= 0.82; p.vy *= 0.82;
    });
  }
  return byId;
}

export default function KnowledgeGraph({ documents = [] }) {
  const { notify } = useApp();
  const navigate = useNavigate();
  const ready = documents.filter((d) => d.status === 'ready');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState(null);
  const [sel, setSel] = useState(null);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const build = async () => {
    setBusy(true); setSel(null);
    try { setGraph(await api.research_graph({ document_ids: [...picked] })); } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const pos = useMemo(() => (graph ? layout(graph.nodes, graph.edges) : null), [graph]);
  const node = graph?.nodes.find((n) => n.id === sel);
  const titleOf = (id) => graph?.documents.find((d) => d.id === id)?.title || 'Source';

  return (
    <section className="research-card knowledge-graph">
      <div className="section-top"><span className="eyebrow">KNOWLEDGE GRAPH</span></div>
      <p className="fineprint" style={{ marginTop: 0 }}>Choose documents to map their key concepts. A link means two ideas appear in the same paragraph; open a concept to see where.</p>
      <div className="cc-docs" role="group" aria-label="Documents to map">
        {ready.map((d) => <label key={d.id} className={picked.has(d.id) ? 'on' : ''}><input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} /> {d.title}</label>)}
      </div>
      <button className="primary-button" disabled={busy || picked.size === 0} onClick={build}>
        {busy ? <Loader2 size={14} className="spin" /> : <Network size={14} />} Build graph
      </button>

      {graph && pos && (graph.nodes.length === 0 ? <p className="muted">Not enough text to find concepts.</p> : (
        <div className="kg-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Concept graph" className="kg-svg">
            {graph.edges.map((e, i) => {
              const a = pos.get(e.source); const b = pos.get(e.target);
              const on = sel && (e.source === sel || e.target === sel);
              return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`kg-edge ${on ? 'on' : ''}`} strokeWidth={Math.min(4, 0.8 + e.weight * 0.6)} /> : null;
            })}
            {graph.nodes.map((n) => {
              const p = pos.get(n.id);
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`kg-node ${n.shared ? 'shared' : ''} ${sel === n.id ? 'sel' : ''}`}
                  tabIndex={0} role="button" aria-label={`${n.label}, ${n.mentions} mentions`} onClick={() => setSel(n.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSel(n.id)}>
                  <circle r={6 + Math.min(10, n.mentions)} />
                  <text y={-12 - Math.min(10, n.mentions)} textAnchor="middle">{n.label}</text>
                </g>
              );
            })}
          </svg>
          <div className="kg-detail" aria-live="polite">
            {!node ? <p className="muted">Select a concept{graph.nodes.some((n) => n.shared) ? ' — ringed ones appear in more than one document' : ''}.</p> : (
              <>
                <h4>{node.label}</h4>
                <small>{node.mentions} mention{node.mentions === 1 ? '' : 's'} in {node.sources.map(titleOf).join(', ')}</small>
                <ul>
                  {node.evidence.map((ev, i) => (
                    <li key={i}>
                      {titleOf(ev.source_id)} · {ev.chapter_title} · paragraph {ev.paragraph_index + 1}{ev.page ? ` · page ${ev.page}` : ''}
                      <button className="text-button" onClick={() => navigate(`/read/${ev.source_id}`)}>Open</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="fineprint">{graph.note}</p>
        </div>
      ))}
    </section>
  );
}
