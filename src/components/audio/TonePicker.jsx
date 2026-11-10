// Choose how the narrator sounds: a tone and a pitch. Used in Settings and inside the read-aloud player.
import React from 'react';
import { Play } from 'lucide-react';
import { TONES } from '../../lib/narrationStyle';

export default function TonePicker({ tone, pitch, onTone, onPitch, onPreview, busy = false, compact = false }) {
  return (
    <div className={`tone-picker ${compact ? 'compact' : ''}`}>
      <div className="tone-grid" role="radiogroup" aria-label="Narration tone">
        {TONES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tone === t.id} className={`tone-chip ${tone === t.id ? 'on' : ''}`} onClick={() => onTone(t.id)}>
            <b>{t.label}</b>
            {!compact && <small>{t.hint}</small>}
          </button>
        ))}
      </div>
      <div className="tone-pitch">
        <label htmlFor="tone-pitch-range">Pitch <output>{pitch > 0 ? `+${pitch}` : pitch}</output></label>
        <input id="tone-pitch-range" type="range" min={-10} max={10} step={1} value={pitch} onChange={(e) => onPitch(+e.target.value)} aria-label="Voice pitch" />
        <span className="tone-pitch-ends" aria-hidden="true"><i>Deeper</i><i>Higher</i></span>
      </div>
      {onPreview && (
        <button type="button" className="secondary-button sm tone-preview" onClick={onPreview} disabled={busy}><Play size={12} /> Hear this tone</button>
      )}
    </div>
  );
}
