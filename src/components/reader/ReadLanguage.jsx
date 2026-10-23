// "Read in …" language toggle: translates the page, the read-aloud script and the transcript.
import React from 'react';
import { ChevronDown, Languages, Loader2 } from 'lucide-react';
import { Menu } from '../ui';

export default function ReadLanguage({ languages = [], value = 'orig', onChange, status, sourceLang = 'en', compact = false, align = 'right' }) {
  const chosen = languages.find((l) => l.code === value);
  const entry = (l) => ({
    label: l.native === l.name ? l.name : `${l.native} · ${l.name}`,
    checked: l.code === value,
    onClick: () => onChange(l.code),
  });
  const rest = languages.filter((l) => l.code !== sourceLang);
  const south = rest.filter((l) => l.region === 'south').map(entry);
  const india = rest.filter((l) => l.region === 'india').map(entry);
  const world = rest.filter((l) => l.region === 'world').map(entry);
  const original = languages.find((l) => l.code === sourceLang);
  const items = languages.length
    ? [{ label: `Original${original ? ` (${original.name})` : ''}`, checked: value === 'orig', onClick: () => onChange('orig') }, '-', ...south, '-', ...india, ...(world.length ? ['-', ...world] : [])]
    : [{ label: 'Loading languages…', disabled: true }];
  const busy = status?.running;

  return (
    <Menu label="Read this in another language" align={compact ? 'up' : align}
      trigger={(
        <span className={`read-lang ${chosen ? 'on' : ''} ${compact ? 'compact' : ''}`} title="Translate this page, its read-aloud and transcript">
          {busy ? <Loader2 size={15} className="spin" /> : <Languages size={compact ? 20 : 17} />}
          {!compact && <span className="read-lang-label" lang={chosen?.code}>{busy ? `${status.progress}%` : chosen ? chosen.native : 'Translate'}</span>}
          {!compact && <ChevronDown size={12} aria-hidden="true" />}
        </span>
      )}
      items={items} />
  );
}
