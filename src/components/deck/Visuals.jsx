// Animated slide visuals: charts, flowchart, hierarchy, mind map, categories, timeline and key figures.
// Everything is laid out in the slide's 1280×720 canvas. `shown(i)` says whether build #i has been revealed yet.
import React, { useEffect, useRef, useState } from 'react';

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString() : String(+v.toFixed(2)));

/** Build wrapper: hidden until its step arrives, then plays the slide's entrance motion. */
export const B = ({ i, shown, className = '', style, children, ...rest }) => (
  <div className={`dk-b ${shown(i) ? 'on' : 'off'} ${className}`} style={{ '--i': i, ...style }} {...rest}>{children}</div>
);

// ─── Charts ───────────────────────────────────────────────────────────────────
export function Chart({ data }) {
  const { kind, labels, values } = data;
  const colors = ['var(--dk-a1)', 'var(--dk-a2)', 'var(--dk-a3)'];
  const max = Math.max(...values, 1);
  const W = 760; const H = 420;
  if (kind === 'donut') {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const R = 150; const C = 2 * Math.PI * R;
    let acc = 0;
    return (
      <div className="dk-donut">
        <svg viewBox="-190 -190 380 380" role="img" aria-label="Donut chart">
          <circle r={R} fill="none" stroke="var(--dk-panel)" strokeWidth="52" />
          {values.map((v, i) => {
            const len = (v / total) * C;
            const seg = (
              <circle key={i} r={R} fill="none" stroke={colors[i % 3]} strokeWidth="52" className="dk-arc" style={{ '--i': i, '--len': len, '--gap': C - len }}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90)" opacity={1 - (Math.floor(i / 3) * 0.22)} />
            );
            acc += len;
            return seg;
          })}
          <text className="dk-donut-total" textAnchor="middle" dy=".35em">{fmt(total)}</text>
        </svg>
        <ul className="dk-legend">
          {labels.map((l, i) => (
            <li key={l + i} style={{ '--i': i }}><i style={{ background: colors[i % 3], opacity: 1 - Math.floor(i / 3) * 0.22 }} /><span>{l}</span><b>{Math.round((values[i] / total) * 100)}%</b></li>
          ))}
        </ul>
      </div>
    );
  }
  const padL = 56; const padB = 70; const padT = 30;
  const plotW = W - padL - 10; const plotH = H - padB - padT;
  const step = plotW / labels.length;
  const y = (v) => padT + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="dk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind} chart`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 10} y1={y(max * t)} y2={y(max * t)} className="dk-grid" />
          <text x={padL - 10} y={y(max * t) + 5} textAnchor="end" className="dk-tick">{fmt(max * t)}</text>
        </g>
      ))}
      {kind === 'bar' && values.map((v, i) => {
        const bw = Math.min(70, step * 0.6);
        const x = padL + step * i + (step - bw) / 2;
        return (
          <g key={i} style={{ '--i': i }}>
            <rect x={x} y={y(v)} width={bw} height={padT + plotH - y(v)} rx="6" className="dk-bar" fill={colors[i % 3]} />
            <text x={x + bw / 2} y={y(v) - 9} textAnchor="middle" className="dk-val" style={{ '--i': i }}>{fmt(v)}</text>
          </g>
        );
      })}
      {kind === 'line' && (
        <>
          <polyline className="dk-line" pathLength="1" fill="none" stroke="var(--dk-a1)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"
            points={values.map((v, i) => `${padL + step * i + step / 2},${y(v)}`).join(' ')} />
          {values.map((v, i) => (
            <g key={i} className="dk-dot" style={{ '--i': i }}>
              <circle cx={padL + step * i + step / 2} cy={y(v)} r="7" fill="var(--dk-bg0)" stroke="var(--dk-a2)" strokeWidth="4" />
              <text x={padL + step * i + step / 2} y={y(v) - 16} textAnchor="middle" className="dk-val">{fmt(v)}</text>
            </g>
          ))}
        </>
      )}
      {labels.map((l, i) => (
        <text key={i} x={padL + step * i + step / 2} y={H - padB + 28} textAnchor="middle" className="dk-xlabel">{clip(l, labels.length > 5 ? 11 : 16)}</text>
      ))}
    </svg>
  );
}

// ─── Flowchart ────────────────────────────────────────────────────────────────
export function Flow({ data, shown }) {
  const nodes = data.nodes;
  const perRow = nodes.length > 4 ? 4 : nodes.length;
  const rows = Math.ceil(nodes.length / perRow);
  const W = 1160; const gap = 56;
  const bw = (W - gap * (perRow - 1)) / perRow; const bh = 120; const vgap = 120;
  const pos = nodes.map((_, i) => { const r = Math.floor(i / perRow); const c = i % perRow; return { x: c * (bw + gap), y: r * (bh + vgap) }; });
  const h = rows * bh + (rows - 1) * vgap + 40;
  return (
    <div className="dk-flow" style={{ height: h }}>
      <svg className="dk-wires" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id="dk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--dk-a2)" /></marker></defs>
        {nodes.slice(0, -1).map((_, i) => {
          const a = pos[i]; const b = pos[i + 1];
          const same = a.y === b.y;
          const d = same ? `M${a.x + bw} ${a.y + bh / 2} L${b.x} ${b.y + bh / 2}`
            : `M${a.x + bw / 2} ${a.y + bh} C${a.x + bw / 2} ${a.y + bh + 70} ${b.x + bw / 2} ${b.y - 70} ${b.x + bw / 2} ${b.y}`;
          return <path key={i} d={d} className={`dk-wire ${shown(i + 1) ? 'on' : 'off'}`} style={{ '--i': i + 1 }} pathLength="1" markerEnd="url(#dk-arrow)" fill="none" stroke="var(--dk-a2)" strokeWidth="3.5" />;
        })}
      </svg>
      {nodes.map((n, i) => (
        <B key={i} i={i} shown={shown} className="dk-node" style={{ left: pos[i].x, top: pos[i].y, width: bw, height: bh }}>
          <span className="dk-badge">{i + 1}</span>
          <strong>{n.label}</strong>
          {n.detail && <small>{n.detail}</small>}
        </B>
      ))}
      {data.loop && <div className="dk-loop" style={{ top: h - 8 }}>↻ the process repeats from step 1</div>}
    </div>
  );
}

// ─── Hierarchy ────────────────────────────────────────────────────────────────
export function Tree({ data, shown }) {
  const root = data.root;
  const kids = root.children;
  const W = 1160; const cw = W / kids.length; const bw = Math.min(250, cw - 26);
  const rootX = W / 2; const rootY = 0; const rw = 340; const rh = 78; const ky = 190; const kh = 70;
  const maxG = Math.max(...kids.map((k) => Math.min(4, k.children.length)), 0);
  const H = ky + kh + 30 + maxG * 66;
  return (
    <div className="dk-tree" style={{ height: H }}>
      <svg className="dk-wires" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {kids.map((k, i) => {
          const cx = cw * (i + 0.5);
          return (
            <g key={i}>
              <path className={`dk-wire ${shown(i) ? 'on' : 'off'}`} style={{ '--i': i }} pathLength="1" fill="none" stroke="var(--dk-a2)" strokeWidth="3"
                d={`M${rootX} ${rootY + rh} C${rootX} ${rootY + rh + 60} ${cx} ${ky - 60} ${cx} ${ky}`} />
              {k.children.slice(0, 4).map((_, j) => (
                <path key={j} className={`dk-wire ${shown(i) ? 'on' : 'off'}`} style={{ '--i': i + j * 0.5 + 1 }} pathLength="1" fill="none" stroke="var(--dk-muted)" strokeWidth="2"
                  d={`M${cx - bw / 2 + 14} ${ky + kh} L${cx - bw / 2 + 14} ${ky + kh + 24 + j * 66 + 22} L${cx - bw / 2 + 28} ${ky + kh + 24 + j * 66 + 22}`} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="dk-tree-root" style={{ left: rootX - rw / 2, top: rootY, width: rw, height: rh }}>{root.label}</div>
      {kids.map((k, i) => {
        const cx = cw * (i + 0.5);
        return (
          <React.Fragment key={i}>
            <B i={i} shown={shown} className="dk-tree-node" style={{ left: cx - bw / 2, top: ky, width: bw, height: kh }}>{k.label}</B>
            {k.children.slice(0, 4).map((g, j) => (
              <B key={j} i={i} shown={shown} className="dk-tree-leaf" style={{ left: cx - bw / 2 + 32, top: ky + kh + 24 + j * 66, width: bw - 40, height: 44, '--j': j }}>{g.label}</B>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Mind map ─────────────────────────────────────────────────────────────────
export function MindMap({ data, title, shown }) {
  const n = data.branches.length;
  const cx = 580; const cy = 270; const rx = 350; const ry = 210;
  const hues = ['var(--dk-a2)', 'var(--dk-a3)', 'var(--dk-a1)'];
  return (
    <div className="dk-mind">
      <svg className="dk-wires" viewBox="0 0 1160 540" aria-hidden="true">
        {data.branches.map((b, i) => {
          const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n;
          const x = cx + rx * Math.cos(a); const y = cy + ry * Math.sin(a);
          const mx = cx + (x - cx) * 0.5; const my = cy + (y - cy) * 0.5 + (i % 2 ? 26 : -26);
          return <path key={i} className={`dk-wire ${shown(i) ? 'on' : 'off'}`} style={{ '--i': i }} pathLength="1" fill="none" stroke={hues[i % 3]} strokeWidth="4" strokeLinecap="round"
            d={`M${cx} ${cy} Q${mx} ${my} ${x} ${y}`} />;
        })}
      </svg>
      <div className="dk-mind-core" style={{ left: cx - 130, top: cy - 62, width: 260, height: 124 }}>{clip(data.root || title, 42)}</div>
      {data.branches.map((b, i) => {
        const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n;
        const x = cx + rx * Math.cos(a); const y = cy + ry * Math.sin(a);
        const right = Math.cos(a) >= 0;
        return (
          <B key={i} i={i} shown={shown} className="dk-mind-branch" style={{ left: x - 100, top: y - 31, width: 200, height: 62, '--hue': hues[i % 3], '--float': `${(i % 3) * 0.7}s` }}>
            <strong>{b.label}</strong>
            {b.children.length > 0 && (
              <ul className={right ? 'r' : 'l'}>{b.children.slice(0, 3).map((c) => <li key={c}>{c}</li>)}</ul>
            )}
          </B>
        );
      })}
    </div>
  );
}

// ─── Categories / comparison ──────────────────────────────────────────────────
export function Columns({ data, shown, versus }) {
  const hues = ['var(--dk-a1)', 'var(--dk-a2)', 'var(--dk-a3)', 'var(--dk-a1)'];
  return (
    <div className="dk-cols" style={{ '--n': data.columns.length }}>
      {data.columns.map((c, i) => (
        <B key={i} i={i} shown={shown} className="dk-col" style={{ '--hue': hues[i] }}>
          <header>{c.title}</header>
          <ul>{c.points.map((p) => <li key={p}>{p}</li>)}</ul>
        </B>
      ))}
      {versus && data.columns.length === 2 && <span className="dk-vs">VS</span>}
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
export function Timeline({ data, shown }) {
  return (
    <div className="dk-timeline" style={{ '--n': data.events.length }}>
      <i className="dk-axis" />
      {data.events.map((e, i) => (
        <B key={i} i={i} shown={shown} className={`dk-event ${i % 2 ? 'down' : 'up'}`}>
          <b>{e.label}</b><span>{e.detail}</span><i className="dk-pin" />
        </B>
      ))}
    </div>
  );
}

// ─── Key figures (numbers count up) ───────────────────────────────────────────
function CountUp({ value, run }) {
  const m = String(value).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  const [n, setN] = useState(run && m ? 0 : null);
  const raf = useRef();
  useEffect(() => {
    if (!m) return undefined;
    const target = parseFloat(m[2].replace(/,/g, ''));
    if (!run || !Number.isFinite(target)) { setN(target); return undefined; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      setN(target * (1 - (1 - k) ** 3));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, run]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return <>{value}</>;
  const dec = (m[2].split('.')[1] || '').length;
  const shownN = n == null ? parseFloat(m[2].replace(/,/g, '')) : n;
  return <>{m[1]}{shownN.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}{m[3]}</>;
}

export function Stats({ data, shown, animate }) {
  return (
    <div className="dk-stats" style={{ '--n': data.items.length }}>
      {data.items.map((it, i) => (
        <B key={i} i={i} shown={shown} className="dk-stat">
          <b><CountUp value={it.value} run={animate && shown(i)} /></b>
          <span>{it.label}</span>
        </B>
      ))}
    </div>
  );
}
