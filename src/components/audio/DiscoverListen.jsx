// Full-screen player for Discover audiobooks and podcasts, in the same look as the read-aloud player.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, FastForward, Gauge, List, Pause, Play, Rewind, SkipBack, SkipForward } from 'lucide-react';
import { Menu } from '../ui';
import AlbumArt from './AlbumArt';
import PowerSeek from './PowerSeek';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP = [0, 15, 30, 60];
const mins = (s) => (s ? `${Math.max(1, Math.round(s / 60))}m` : '');

export default function DiscoverListen({ item, tracks, onClose }) {
  const audio = useRef(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [sleep, setSleep] = useState(0);
  const [list, setList] = useState(false);
  const track = tracks[i];
  const last = i >= tracks.length - 1;

  useEffect(() => {
    if (!audio.current || !track) return;
    setTime(0); setDuration(0);
    audio.current.src = track.url;
    audio.current.playbackRate = rate;
    audio.current.play().catch(() => setPlaying(false));
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sleep) return undefined;
    const t = setTimeout(() => { audio.current?.pause(); setSleep(0); }, sleep * 60000);
    return () => clearTimeout(t);
  }, [sleep]);

  const toggle = () => (audio.current.paused ? audio.current.play() : audio.current.pause());
  const skip = (d) => { audio.current.currentTime = Math.max(0, Math.min(duration || Infinity, audio.current.currentTime + d)); };
  const changeRate = (r) => { setRate(r); audio.current.playbackRate = r; };

  return (
    <div className="mr-listen" role="dialog" aria-label="Now playing">
      <audio ref={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => !last && setI((n) => n + 1)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)} />
      <header>
        <button onClick={onClose} aria-label="Close player"><ChevronDown size={24} /></button>
      </header>

      {list ? (
        <ol className="dl-tracks">
          {tracks.map((t, n) => (
            <li key={t.url}><button className={n === i ? 'on' : ''} onClick={() => { setI(n); setList(false); }}><span>{n + 1}</span><em>{t.title}</em><small>{mins(t.seconds)}</small></button></li>
          ))}
        </ol>
      ) : (
        <div className="ls-cover">
          <div className="ls-art"><AlbumArt title={item.title} kicker={item.author} color="coral" size="lg" playing={playing} /></div>
          <div className="ls-meta">
            <div className="ls-meta-text"><h2>{track?.title || 'Loading…'}</h2><p>{item.title} · {item.author}</p></div>
          </div>
        </div>
      )}

      <div className="ls-progress">
        <PowerSeek value={time} max={duration} seed={`${item.title}|${track?.title}`} playing={playing} disabled={!duration} onSeek={(t) => { audio.current.currentTime = t; setTime(t); }} />
        <div className="ls-times"><span className="ls-badge">{rate}× speed</span></div>
      </div>

      <div className="ls-controls">
        <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} aria-label="Previous part"><SkipBack size={28} fill="currentColor" /></button>
        <button onClick={() => skip(-10)} aria-label="Back 10 seconds"><Rewind size={34} fill="currentColor" /></button>
        <button className="ls-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={44} fill="currentColor" /> : <Play size={44} fill="currentColor" />}
        </button>
        <button onClick={() => skip(30)} aria-label="Forward 30 seconds"><FastForward size={34} fill="currentColor" /></button>
        <button onClick={() => setI((n) => n + 1)} disabled={last} aria-label="Next part"><SkipForward size={28} fill="currentColor" /></button>
      </div>

      <div className="ls-tools">
        <span className="ls-count">{i + 1} / {tracks.length}</span>
        <Menu label="Speed" align="up" trigger={<span className="ls-pill"><Gauge size={16} /> {rate}×</span>}
          items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === rate, onClick: () => changeRate(s) }))} />
        <Menu label="Sleep timer" align="up" trigger={<span className={`ls-pill ${sleep ? 'on' : ''}`}><Clock size={16} /> {sleep ? `${sleep}m` : 'Sleep'}</span>}
          items={SLEEP.map((m) => ({ label: m ? `${m} minutes` : 'Off', checked: sleep === m, onClick: () => setSleep(m) }))} />
        <button className={list ? 'on' : ''} onClick={() => setList((l) => !l)} aria-pressed={list} aria-label="Parts list"><List size={20} /></button>
      </div>
    </div>
  );
}
