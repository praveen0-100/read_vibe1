// Split control for the reader: [ Overview ] [ Select language ▾ ].
// The dropdown starts as the placeholder "Select language"; choosing one (Southern languages first) opens the
// Audio Overview already set to it, and the control then shows that language in its own script.
import React from 'react';
import { AudioLines, ChevronDown } from 'lucide-react';
import { Menu } from '../ui';

export default function OverviewLauncher({ languages, value, onOpen, onPick, compact = false }) {
  const chosen = languages.find((l) => l.code === value);
  const entry = (l) => ({
    label: l.native === l.name ? l.name : `${l.native} · ${l.name}`,
    checked: l.code === value,
    disabled: !l.has_voice,
    onClick: () => onPick(l.code),
  });
  const south = languages.filter((l) => l.region === 'south').map(entry);
  const india = languages.filter((l) => l.region === 'india').map(entry);
  const world = languages.filter((l) => l.region === 'world').map(entry);

  return (
    <div className={`ov-launch ${compact ? 'compact' : ''}`}>
      <button type="button" className="ov-launch-main" onClick={() => onOpen(value)} aria-label="Open audio overview">
        <AudioLines size={14} /> Overview
      </button>
      <Menu label="Select language for the audio overview" align="up"
        trigger={(
          <span className={`ov-launch-select ${chosen ? 'chosen' : ''}`}>
            {chosen ? <b lang={chosen.code}>{chosen.native}</b> : <span className="placeholder">Select language</span>}
            <ChevronDown size={13} aria-hidden="true" />
          </span>
        )}
        items={languages.length ? [...south, '-', ...india, '-', ...world] : [{ label: 'Loading languages…', disabled: true }]} />
    </div>
  );
}
