// The reader's mode control: a segmented switch with a sliding indicator, a keyboard hint per mode and a live dot when a mode
// has something running in the background (the Zen timer / ambience, the Vibe music).
import React from 'react';

export default function ModeSwitch({ modes, mode, onChange, live = {} }) {
  const index = Math.max(0, modes.findIndex((m) => m.id === mode));
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = modes[(index + (e.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length];
    onChange(next.id);
    requestAnimationFrame(() => e.currentTarget.parentElement.querySelector('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="mode-switch" role="tablist" aria-label="Reading mode" style={{ '--i': index, '--n': modes.length }} onKeyDown={onKey}>
      <span className="ms-thumb" aria-hidden="true" />
      {modes.map(({ id, icon: Icon, key }) => (
        <button key={id} role="tab" aria-selected={mode === id} tabIndex={mode === id ? 0 : -1} className={`ms-tab ms-${id.toLowerCase()}`}
          onClick={() => onChange(id)} title={`${id} mode (${key})`}>
          <Icon size={15} aria-hidden="true" />
          <span className="ms-label">{id}</span>
          <kbd aria-hidden="true">{key}</kbd>
          {live[id] && <i className="ms-live" role="img" aria-label={`${id} is running`} />}
        </button>
      ))}
    </div>
  );
}
