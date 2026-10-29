// Shared shell for the Zen and Vibe control panels: a titled instrument panel with a status lamp, labelled sections,
// and small readouts. Pure presentation — behaviour stays in ZenPanel / VibePanel.
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/** Where the reader is a single column (≤ 900px) the panel starts collapsed to its header (title, status and an optional quick control) and expands on tap. */
export function Panel({ icon: Icon, title, status, live = false, className = '', quick = null, children }) {
  const mobile = useMediaQuery('(max-width: 900px)');
  const [open, setOpen] = useState(false);
  const expanded = !mobile || open;
  const heading = <>{Icon && <Icon size={14} aria-hidden="true" />}{title}</>;
  return (
    <section className={`mp ${className} ${mobile ? 'collapsible' : ''} ${expanded ? 'open' : ''}`} aria-label={`${title} controls`}>
      <header className="mp-head">
        {mobile
          ? <button type="button" className="mp-title mp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{heading}<ChevronDown size={14} className="mp-chev" aria-hidden="true" /></button>
          : <span className="mp-title">{heading}</span>}
        <span className="mp-head-right">
          {mobile && !open && quick}
          <span className={`mp-status ${live ? 'live' : ''}`}><i aria-hidden="true" />{status}</span>
        </span>
      </header>
      {expanded && <div className="mp-body">{children}</div>}
    </section>
  );
}

export function Section({ label, aside, children, className = '' }) {
  return (
    <div className={`mp-sec ${className}`}>
      <div className="mp-sec-head"><span>{label}</span>{aside != null && <small>{aside}</small>}</div>
      {children}
    </div>
  );
}

/** A little level meter: animated while `active`, flat otherwise. Decorative. */
export function LevelMeter({ active, bars = 20 }) {
  return (
    <div className={`lvl ${active ? 'on' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => <i key={i} style={{ '--k': i, '--d': `${(i * 137) % 900}ms`, '--h': `${28 + ((i * 53) % 62)}%` }} />)}
    </div>
  );
}

/** One option of a radio list: a titled row with a marker, used for music sources. */
export function Choice({ icon: Icon, title, hint, on, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`mp-choice ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="mp-choice-ico">{Icon && <Icon size={14} aria-hidden="true" />}</span>
      <span className="mp-choice-txt"><b>{title}</b>{hint && <small>{hint}</small>}</span>
      <i className="mp-choice-dot" aria-hidden="true" />
    </button>
  );
}
