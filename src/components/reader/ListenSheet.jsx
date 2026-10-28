// Full-screen "now reading aloud" player: cover view and synced-text (lyrics) view.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, FastForward, Gauge, List, MoreVertical, Pause, Play, Quote, Rewind, Star } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatClock } from '../../lib/format';
import { Cover, Menu } from '../ui';
import LyricsView from '../audio/LyricsView';
import AlbumArt from '../audio/AlbumArt';
import PowerSeek from '../audio/PowerSeek';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP = [0, 15, 30, 60];

export default function ListenSheet({ doc, title, narrator, listen, onStart, onContents, onClose, onBookmark, bookmarked, moreItems = [], languageControl = null, lang }) {
  const { prefs, setPrefs, notify } = useApp();
  const [lyrics, setLyrics] = useState(false);
  const [sleep, setSleep] = useState(0);
  const [, force] = useState(0);
  const timer = useRef(null);
  const rate = prefs.audio.rate;

  // live clock while playing
  useEffect(() => {
    if (!listen.playing) return undefined;
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [listen.playing]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!sleep) return undefined;
    timer.current = setTimeout(() => { narrator.pause(); setSleep(0); notify('Sleep timer ended — playback paused', 'info'); }, sleep * 60000);
    return () => clearTimeout(timer.current);
  }, [sleep, narrator, notify]);

  const loaded = narrator.script.length > 0;
  const elapsed = narrator.elapsedSeconds;
  const total = narrator.totalSeconds;
  const toggle = () => (loaded ? narrator.toggle() : onStart());
  const changeRate = (r) => { setPrefs({ audio: { rate: r } }); narrator.setRate(r); };

  const actions = (
    <div className="ls-actions">
      <button className={`ls-round ${bookmarked ? 'on' : ''}`} onClick={onBookmark} aria-pressed={!!bookmarked} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this spot'}><Star size={20} fill="currentColor" /></button>
      <Menu label="More" align="right" trigger={<span className="ls-round dim"><MoreVertical size={20} /></span>} items={moreItems} />
    </div>
  );
  return (
    <div className="mr-listen" role="dialog" aria-label="Read aloud player">
      <header>
        <button onClick={onClose} aria-label="Close player"><ChevronDown size={24} /></button>
        {lyrics && (
          <div className="ls-mini">
            <div className="ls-mini-cover"><Cover doc={doc} size="sm" /></div>
            <div className="ls-mini-text"><strong>{title}</strong><span>{doc.title}</span></div>
          </div>
        )}
        {lyrics && actions}
      </header>

      {lyrics && (
        <div className="tx-head">
          <span className="eyebrow">TRANSCRIPT</span>
          {languageControl}
        </div>
      )}
      {lyrics ? (
        loaded ? <LyricsView narrator={narrator} lang={lang} reducedMotion={prefs.accessibility.reducedMotion} />
          : <div className="lyrics"><p className="lyrics-empty">Press play to start reading aloud.</p></div>
      ) : (
        <div className="ls-cover">
          <div className="ls-art"><AlbumArt title={doc.title} kicker={doc.author} color={doc.color || 'coral'} size="lg" playing={listen.playing} /></div>
          <div className="ls-meta">
            <div className="ls-meta-text"><h2>{title}</h2><p>{doc.title} · {doc.author}</p></div>
            {actions}
          </div>
        </div>
      )}

      <div className="ls-progress">
        <PowerSeek value={elapsed} max={total} seed={`${doc.title}|${title}`} playing={listen.playing} disabled={!loaded} onSeek={(t) => narrator.seekTime(t)} />
        <div className="ls-times"><span className="ls-badge">{rate}× speed</span></div>
      </div>

      <div className="ls-controls">
        <button onClick={() => narrator.skip(-10)} disabled={!loaded} aria-label="Back 10 seconds"><Rewind size={34} fill="currentColor" /></button>
        <button className="ls-play" onClick={toggle} aria-label={listen.playing ? 'Pause' : 'Play'}>
          {listen.playing ? <Pause size={44} fill="currentColor" /> : <Play size={44} fill="currentColor" />}
        </button>
        <button onClick={() => narrator.skip(30)} disabled={!loaded} aria-label="Forward 30 seconds"><FastForward size={34} fill="currentColor" /></button>
      </div>

      <div className="ls-tools">
        <button className={`ls-text ${lyrics ? 'on' : ''}`} onClick={() => setLyrics((l) => !l)} aria-pressed={lyrics} aria-label="Transcript"><Quote size={18} fill={lyrics ? 'currentColor' : 'none'} /> <span>Transcript</span></button>
        <Menu label="Speed" align="up" trigger={<span className="ls-pill"><Gauge size={16} /> {rate}×</span>}
          items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === rate, onClick: () => changeRate(s) }))} />
        <Menu label="Sleep timer" align="up" trigger={<span className={`ls-pill ${sleep ? 'on' : ''}`}><Clock size={16} /> {sleep ? `${sleep}m` : 'Sleep'}</span>}
          items={SLEEP.map((m) => ({ label: m ? `${m} minutes` : 'Off', checked: sleep === m, onClick: () => setSleep(m) }))} />
        <button onClick={onContents} aria-label="Contents"><List size={20} /></button>
      </div>
    </div>
  );
}
