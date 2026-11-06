// Annotate panel: Highlight / Underline / Outline tabs, a "None" swatch plus named colours; styles stack on the same text.
import React, { useState } from 'react';
import { ArrowLeft, Ban } from 'lucide-react';
import { STYLES, describeMarks, setMark } from '../../lib/annotations';

export default function AnnotatePanel({ marks = {}, onChange, onBack, compact = false }) {
  const [tab, setTab] = useState('highlight');
  const [hover, setHover] = useState(null);
  const style = STYLES.find((s) => s.id === tab);
  const current = marks[tab] || null;
  const currentName = current ? style.palette.find((c) => c.id === current)?.name : 'None';

  return (
    <div className={`annotate-panel ${compact ? 'compact' : ''}`} role="group" aria-label="Annotate">
      <div className="ap-top">
        {onBack && <button className="ap-back" onClick={onBack} aria-label="Back"><ArrowLeft size={15} /></button>}
        <div className="ap-tabs" role="tablist">
          {STYLES.map((s) => (
            <button key={s.id} role="tab" aria-selected={tab === s.id} className={`${tab === s.id ? 'on' : ''} ap-${s.id}`} onClick={() => setTab(s.id)} title={s.label}>
              <span className="ap-glyph" aria-hidden="true">A</span> {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ap-swatches" role="radiogroup" aria-label={`${style.label} colour`}>
        <button role="radio" aria-checked={!current} aria-label="None" className={`ap-sw none ${!current ? 'on' : ''}`} onClick={() => onChange(setMark(marks, tab, null))}
          onMouseEnter={() => setHover('None')} onMouseLeave={() => setHover(null)}><Ban size={14} /></button>
        {style.palette.map((c) => (
          <button key={c.id} role="radio" aria-checked={current === c.id} aria-label={c.name} title={c.name} className={`ap-sw ${current === c.id ? 'on' : ''}`}
            style={{ background: c.value === 'currentColor' ? '#000' : c.value }} onClick={() => onChange(setMark(marks, tab, c.id))}
            onMouseEnter={() => setHover(c.name)} onMouseLeave={() => setHover(null)} />
        ))}
      </div>
      <div className="ap-name" aria-live="polite">{hover || currentName}</div>
      {describeMarks(marks) && <div className="ap-summary">{describeMarks(marks)}</div>}
    </div>
  );
}
