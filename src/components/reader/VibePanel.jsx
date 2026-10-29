// Vibe mode controls: now-playing deck, music source, and the mix (music volume, text contrast), laid out as an instrument panel.
import React, { useEffect, useRef } from 'react';
import { AudioLines, FolderOpen, Pause, Play, Radio, SkipBack, SkipForward, Sun, Volume2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GENERATIVE_STATIONS } from '../../lib/vibeMusic';
import { Slider } from '../ui';
import { Choice, LevelMeter, Panel, Section } from './ModePanel';

export default function VibePanel({ player, music }) {
  const { prefs, setPrefs, notify } = useApp();
  const vibe = prefs.vibe;
  const fileRef = useRef(null);
  useEffect(() => { player.setVolume(vibe.volume); }, [player, vibe.volume]);

  const loadFiles = (files) => {
    const n = player.loadFiles(files);
    if (n) { notify(`${n} track${n > 1 ? 's' : ''} loaded from this device`); player.play(); }
    else notify('No playable audio files found', 'warning');
  };

  return (
    <Panel icon={AudioLines} title="Vibe" live={music.playing} status={music.playing ? 'PLAYING' : 'PAUSED'} className="vibe-controls"
      quick={<button className={`mp-quick ${music.playing ? 'playing' : ''}`} onClick={() => player.toggle()} aria-label={music.playing ? 'Pause music' : 'Play music'} aria-pressed={music.playing}>{music.playing ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}</button>}>
      <Section label="Now playing">
        <div className="mp-deck vibe">
          <div className="mp-track">
            <strong title={music.title}>{music.title}</strong>
            <small title={music.subtitle}>{music.subtitle}</small>
          </div>
          <LevelMeter active={music.playing} bars={26} />
        </div>
        <div className="mp-transport" role="group" aria-label="Transport">
          <button onClick={() => player.prev()} aria-label="Previous"><SkipBack size={16} /></button>
          <button className={`mp-play ${music.playing ? 'playing' : ''}`} onClick={() => player.toggle()} aria-label={music.playing ? 'Pause music' : 'Play music'} aria-pressed={music.playing}>
            {music.playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
          </button>
          <button onClick={() => player.next()} aria-label="Next"><SkipForward size={16} /></button>
        </div>
      </Section>

      <Section label="Source" aside={music.mode === 'local' ? 'Your files' : 'Generated'}>
        <div className="mp-choices" role="radiogroup" aria-label="Music source">
          {GENERATIVE_STATIONS.map((s) => (
            <Choice key={s.id} icon={Radio} title={s.name} hint={`${s.bpm} BPM · ${s.mood}`} on={music.mode === 'generative' && player.station.id === s.id} onClick={() => player.useStation(s.id)} />
          ))}
          <Choice icon={FolderOpen} title="Local music…" hint="Songs from this device — they never leave your browser" on={music.mode === 'local'} onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
        </div>
      </Section>

      <Section label="Mix">
        <Slider label="Music" icon={Volume2} value={vibe.volume} onChange={(v) => setPrefs({ vibe: { volume: v } })} format={(v) => `${v}%`} />
        <Slider label="Text contrast" icon={Sun} value={vibe.contrast} min={50} max={100} onChange={(v) => setPrefs({ vibe: { contrast: v } })} format={(v) => `${v}%`} />
      </Section>
    </Panel>
  );
}
