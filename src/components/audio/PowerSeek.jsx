// Waveform seek bar in the style of Poweramp: a glowing bar-graph of the track, a bright playhead with a knob,
// elapsed / remaining times beneath. Drag (or arrow keys) to scrub; the seek is applied when you let go.
import React, { useMemo, useRef, useState } from 'react';
import { formatClock } from '../../lib/format';

const BARS = 88;

const hash = (s = '') => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Deterministic, speech-like envelope: slow swells with fast detail, so every track has its own shape. */
function envelope(seed) {
  let h = hash(seed) || 1;
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  const a = rand() * 6; const b = rand() * 6;
  return Array.from({ length: BARS }, (_, i) => {
    const swell = 0.5 + 0.28 * Math.sin(i / 7 + a) + 0.16 * Math.sin(i / 3.1 + b);
    return Math.max(0.14, Math.min(1, swell * (0.62 + rand() * 0.5)));
  });
}

export default function PowerSeek({ value = 0, max = 1, onSeek, seed = '', playing = false, disabled = false, remaining = true, label = 'Seek', className = '' }) {
  const bars = useMemo(() => envelope(seed), [seed]);
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // seconds while scrubbing
  const total = Math.max(1, max);
  const shown = drag ?? value;
  const ratio = Math.max(0, Math.min(1, shown / total));

  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
  };
  const down = (e) => {
    if (disabled) return;
    ref.current.setPointerCapture?.(e.pointerId);
    setDrag(at(e));
  };
  const move = (e) => { if (drag != null) setDrag(at(e)); };
  const up = (e) => {
    if (drag == null) return;
    const t = at(e);
    setDrag(null);
    onSeek?.(t);
  };
  const key = (e) => {
    const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step != null) { e.preventDefault(); onSeek?.(Math.max(0, Math.min(total, value + step))); }
    if (e.key === 'Home') { e.preventDefault(); onSeek?.(0); }
    if (e.key === 'End') { e.preventDefault(); onSeek?.(total); }
  };
  const lit = Math.round(ratio * BARS);

  return (
    <div className={`powerseek ${playing ? 'is-playing' : ''} ${drag != null ? 'is-drag' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}>
      <div ref={ref} className="ps-track" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(shown)} aria-valuetext={`${formatClock(shown)} of ${formatClock(total)}`} aria-disabled={disabled}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={key}>
        <div className="ps-bars" aria-hidden="true">
          {bars.map((h, i) => (
            <i key={i} className={i < lit ? 'on' : ''} style={{ '--h': `${Math.round(h * 100)}%`, '--i': i, ...(playing && Math.abs(i - lit) < 3 ? { '--near': 1 } : null) }} />
          ))}
        </div>
        <div className="ps-head" style={{ left: `${ratio * 100}%` }} aria-hidden="true"><span className="ps-knob" />{drag != null && <output className="ps-tip">{formatClock(shown)}</output>}</div>
      </div>
      <div className="ps-times">
        <span>{formatClock(shown)}</span>
        <span>{remaining ? `-${formatClock(Math.max(0, total - shown))}` : formatClock(total)}</span>
      </div>
    </div>
  );
}
