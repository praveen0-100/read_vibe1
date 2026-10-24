// Zen mode controls: background music (play/pause + volume) and a Pomodoro focus timer.
import React, { useEffect, useRef, useState } from 'react';
import { Coffee, Pause, Play, RotateCcw, Timer, Volume2, Wind } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { playChime } from '../../lib/ambient';
import { Slider } from '../ui';

export function useFocusTimer({ documentId, onPhaseEnd }) {
  const { prefs } = useApp();
  const [phase, setPhase] = useState('idle'); // idle | focus | break
  const [left, setLeft] = useState(prefs.zen.focusMinutes * 60);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const endRef = useRef(onPhaseEnd);
  endRef.current = onPhaseEnd;

  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (left > 0 || !running) return;
    playChime();
    if (phase === 'focus') {
      setCycles((c) => c + 1);
      api.activity.logSession({ document_id: documentId, kind: 'focus', mode: 'Zen', seconds: prefs.zen.focusMinutes * 60 }).catch(() => {});
      setPhase('break');
      setLeft(prefs.zen.breakMinutes * 60);
      endRef.current?.('focus');
    } else {
      setPhase('focus');
      setLeft(prefs.zen.focusMinutes * 60);
      endRef.current?.('break');
    }
  }, [left, running, phase, documentId, prefs.zen.focusMinutes, prefs.zen.breakMinutes]);

  return {
    phase, left, running, cycles,
    start: () => { if (phase === 'idle') { setPhase('focus'); setLeft(prefs.zen.focusMinutes * 60); } setRunning(true); },
    pause: () => setRunning(false),
    reset: () => { setRunning(false); setPhase('idle'); setLeft(prefs.zen.focusMinutes * 60); },
  };
}

const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export default function ZenPanel({ engine, timer, ambientOn, setAmbientOn }) {
  const { prefs, setPrefs } = useApp();
  const zen = prefs.zen;

  useEffect(() => { engine.setMaster(zen.volume); }, [engine, zen.volume]);
  useEffect(() => {
    if (ambientOn) engine.start().catch(() => setAmbientOn(false)); // autoplay blocked: show the Play button
    else engine.stop();
  }, [engine, ambientOn]); // eslint-disable-line

  const total = (timer.phase === 'break' ? zen.breakMinutes : zen.focusMinutes) * 60;
  const pct = timer.phase === 'idle' ? 0 : 1 - timer.left / total;

  return (
    <div className="zen-controls">
      <div className="zen-head">
        <span className="eyebrow">MUSIC</span>
        <button className={`play-ambient ${ambientOn ? 'playing' : ''}`} onClick={() => setAmbientOn(!ambientOn)} aria-label={ambientOn ? 'Pause music' : 'Play music'}>
          {ambientOn ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
        </button>
      </div>
      <Slider label="Volume" icon={Volume2} value={zen.volume} onChange={(v) => setPrefs({ zen: { volume: v } })} format={(v) => `${v}%`} />

      <div className="zen-timer">
        <div className="timer-ring" style={{ '--pct': pct }} role="timer" aria-live="off" aria-label={`${timer.phase === 'break' ? 'Break' : 'Focus'} time left ${fmt(timer.left)}`}>
          <strong>{fmt(timer.left)}</strong>
          <small>{timer.phase === 'break' ? 'Break' : timer.phase === 'focus' ? 'Focus' : 'Ready'}</small>
        </div>
        <div className="timer-side">
          <div className="timer-buttons">
            {timer.running
              ? <button className="secondary-button small" onClick={timer.pause}><Pause size={13} /> Pause</button>
              : <button className="primary-button small" onClick={timer.start}><Timer size={13} /> {timer.phase === 'idle' ? 'Start focus' : 'Resume'}</button>}
            {timer.phase !== 'idle' && <button className="icon-ghost sm" onClick={timer.reset} aria-label="Reset timer"><RotateCcw size={13} /></button>}
          </div>
          <div className="timer-config">
            <label><Wind size={12} /> Focus
              <select value={zen.focusMinutes} onChange={(e) => setPrefs({ zen: { focusMinutes: +e.target.value } })} disabled={timer.running}>
                {[10, 15, 20, 25, 30, 45, 50, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <label><Coffee size={12} /> Break
              <select value={zen.breakMinutes} onChange={(e) => setPrefs({ zen: { breakMinutes: +e.target.value } })} disabled={timer.running}>
                {[3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </div>
          {timer.cycles > 0 && <small className="muted">{timer.cycles} focus session{timer.cycles > 1 ? 's' : ''} completed</small>}
        </div>
      </div>

    </div>
  );
}
