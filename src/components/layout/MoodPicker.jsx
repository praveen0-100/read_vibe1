// The mood chooser: a swatch grid in a small popover (sidebar and phone header) and an inline grid for Settings.
import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MOODS, autoMood, moodById, moodSwatch } from '../../lib/mood';
import { resolveTheme } from '../../lib/prefs';

function Swatch({ id, light }) {
  const [bg, fg] = moodSwatch(id, light);
  return <span className="mood-swatch" style={{ '--sw-a': bg, '--sw-b': fg }} aria-hidden="true" />;
}

export function MoodGrid({ onPick }) {
  const { prefs, setPrefs } = useApp();
  const light = resolveTheme(prefs.theme) === 'light';
  const current = prefs.mood || 'auto';
  return (
    <div className="mood-grid" role="radiogroup" aria-label="Mood">
      {MOODS.map(({ id, label, blurb, icon: Icon }) => (
        <button key={id} role="radio" aria-checked={current === id} className={`mood-card ${current === id ? 'chosen' : ''}`}
          onClick={() => { setPrefs({ mood: id }); onPick?.(id); }}>
          <Swatch id={id} light={light} />
          <span className="mood-name"><Icon size={14} aria-hidden="true" /> {label}{id === 'auto' && <small> · now {moodById(autoMood()).label}</small>}</span>
          <small className="mood-blurb">{blurb}</small>
          {current === id && <Check size={14} className="mood-check" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/** A compact button that opens the grid. `placement` decides which way the popover opens. */
export default function MoodPicker({ collapsed = false, placement = 'up', iconOnly = false }) {
  const { prefs } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const light = resolveTheme(prefs.theme) === 'light';
  const current = prefs.mood || 'auto';
  const shown = moodById(current === 'auto' ? autoMood() : current);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="mood-picker" ref={ref}>
      <button className={`mood-trigger ${iconOnly ? 'icon' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Mood: ${current === 'auto' ? `Auto (${shown.label})` : shown.label}. Change mood`} title="Match the app to your mood">
        <Swatch id={current} light={light} />
        {!collapsed && !iconOnly && <span className="mood-trigger-text"><b>Mood</b><small>{current === 'auto' ? `Auto · ${shown.label}` : shown.label}</small></span>}
      </button>
      {open && (
        <div className={`mood-pop ${placement}`} role="dialog" aria-label="Choose your mood">
          <div className="mood-pop-head"><strong>How are you feeling?</strong><small>The whole app follows your mood.</small></div>
          <MoodGrid onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
