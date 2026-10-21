// Vibe mode controls: music (local files or generative stations), visual presets, contrast.
import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Heart, Music, Pause, Play, SkipBack, SkipForward, Sun, Trash2, Volume2, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GENERATIVE_STATIONS } from '../../lib/vibeMusic';
import { Slider } from '../ui';
import { VIBE_PRESETS } from './Scenes';

export default function VibePanel({ player, music }) {
  const { prefs, setPrefs, notify } = useApp();
  const vibe = prefs.vibe;
  const fileRef = useRef(null);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => { player.setVolume(vibe.volume); }, [player, vibe.volume]);

  const choosePreset = (p) => {
    setPrefs({ vibe: { preset: p.id } });
    if (music.mode === 'generative') player.useStation(p.station);
  };

  const loadFiles = (files) => {
    const n = player.loadFiles(files);
    if (n) { notify(`${n} track${n > 1 ? 's' : ''} loaded from this device`); player.play(); }
    else notify('No playable audio files found', 'warning');
  };

  const saveCombo = () => {
    const combo = { id: Date.now(), preset: vibe.preset, contrast: vibe.contrast, intensity: vibe.intensity, volume: vibe.volume, station: player.station.id };
    setPrefs({ vibe: { savedCombos: [...(vibe.savedCombos || []), combo].slice(-6) } });
    setConfirmSave(true);
    setTimeout(() => setConfirmSave(false), 1500);
  };
  const applyCombo = (c) => {
    setPrefs({ vibe: { preset: c.preset, contrast: c.contrast, intensity: c.intensity, volume: c.volume } });
    player.useStation(c.station);
  };

  return (
    <div className="vibe-controls">
      <div className="vibe-now-playing">
        <Music size={15} />
        <div>
          <strong>{music.title}</strong>
          <small>{music.subtitle}</small>
        </div>
      </div>
      <div className="vibe-transport">
        <button onClick={() => player.prev()} aria-label="Previous"><SkipBack size={16} /></button>
        <button className={`play-btn ${music.playing ? 'playing' : ''}`} onClick={() => player.toggle()} aria-label={music.playing ? 'Pause music' : 'Play music'}>
          {music.playing ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
        </button>
        <button onClick={() => player.next()} aria-label="Next"><SkipForward size={16} /></button>
        <button onClick={saveCombo} aria-label="Save this vibe as a favorite" className={confirmSave ? 'saved' : ''}><Heart size={15} fill={confirmSave ? 'currentColor' : 'none'} /></button>
      </div>

      <div className="vibe-source">
        <div className="eyebrow">MUSIC SOURCE</div>
        <div className="station-list">
          {GENERATIVE_STATIONS.map((s) => (
            <button key={s.id} className={`chip ${music.mode === 'generative' && player.station.id === s.id ? 'active' : ''}`} onClick={() => player.useStation(s.id)}>{s.name}</button>
          ))}
          <button className={`chip ${music.mode === 'local' ? 'active' : ''}`} onClick={() => fileRef.current?.click()}><FolderOpen size={12} /> Local music…</button>
          <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <small className="muted">Pick songs from this device — they never leave your browser.</small>
      </div>

      <div className="eyebrow">VISUAL AMBIANCE</div>
      <div className="vibe-presets-grid">
        {VIBE_PRESETS.map((p) => (
          <button key={p.id} className={`vibe-preset hue-${p.hue} ${vibe.preset === p.id ? 'active' : ''}`} onClick={() => choosePreset(p)} aria-pressed={vibe.preset === p.id}>
            <span aria-hidden="true">{p.emoji}</span><small>{p.name}</small>
          </button>
        ))}
      </div>

      <div className="vibe-sliders">
        <Slider label="Music" icon={Volume2} value={vibe.volume} onChange={(v) => setPrefs({ vibe: { volume: v } })} format={(v) => `${v}%`} />
        <Slider label="Text contrast" icon={Sun} value={vibe.contrast} min={50} max={100} onChange={(v) => setPrefs({ vibe: { contrast: v } })} format={(v) => `${v}%`} />
        <Slider label="Animation" icon={Zap} value={vibe.intensity} onChange={(v) => setPrefs({ vibe: { intensity: v } })} format={(v) => (v ? `${v}%` : 'static')} />
      </div>

      {vibe.savedCombos?.length > 0 && (
        <>
          <div className="eyebrow">SAVED VIBES</div>
          <div className="saved-combos">
            {vibe.savedCombos.map((c) => {
              const p = VIBE_PRESETS.find((x) => x.id === c.preset);
              return (
                <span key={c.id} className="chip">
                  <button onClick={() => applyCombo(c)}>{p?.emoji} {p?.name} · {GENERATIVE_STATIONS.find((s) => s.id === c.station)?.name.split(' ')[0]}</button>
                  <button onClick={() => setPrefs({ vibe: { savedCombos: vibe.savedCombos.filter((x) => x.id !== c.id) } })} aria-label="Remove saved vibe"><Trash2 size={11} /></button>
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
