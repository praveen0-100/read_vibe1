// ─── Audio Studio Page ────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  Headphones, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  ChevronLeft, ChevronRight, Bookmark, Clock, Download, Share2,
  Mic, Smile, Zap, BookOpen, ChevronDown, RotateCcw, FastForward,
  Rewind, Plus, Users, Music
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProgressBar, EmptyState, SectionHead } from '../components/ui';
import { AUDIOBOOKS } from '../data/mockData';

const TONES = [
  {
    id: 'Regular',
    label: 'Regular',
    icon: BookOpen,
    description: 'Neutral, clear and balanced narration for everyday documents.',
    badge: 'Most used',
    color: 'var(--accent)',
  },
  {
    id: 'Humor',
    label: 'Humor',
    icon: Smile,
    description: 'Upbeat, expressive and engaging. Perfect for light fiction.',
    badge: 'Fan favorite',
    color: '#73c99e',
  },
  {
    id: 'Tough',
    label: 'Tough',
    icon: Zap,
    description: 'Authoritative and serious. Ideal for academic or historical content.',
    badge: 'Study mode',
    color: '#c4b4ec',
  },
];

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

// ─── Audio Player ─────────────────────────────────────────────────────────────
function AudioPlayer({ audiobook, doc }) {
  const { state, dispatch, notify } = useApp();
  const { audioPlaying, audioProgress, audioSpeed } = state;
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(0);

  const chapters = doc?.chapters || [{ title: 'Chapter 1', duration: '30 min' }];

  // Simulate playback progress
  useEffect(() => {
    let interval;
    if (audioPlaying) {
      interval = setInterval(() => {
        dispatch({ type: 'SET_AUDIO_PROGRESS', payload: Math.min(audioProgress + 0.5, 100) });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [audioPlaying, audioProgress]);

  const formatTime = (pct, total = 382) => {
    const secs = Math.floor((pct / 100) * total * 60);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="audio-player">
      {/* Track info */}
      <div className="player-track">
        <div className={`player-cover cover-${doc?.color || 'coral'}`}>
          <Headphones size={28} />
        </div>
        <div className="player-info">
          <div className="eyebrow">NOW PLAYING</div>
          <h3>{audiobook?.title || doc?.title}</h3>
          <p>{audiobook?.tone || 'Regular'} narration · {chapters[currentChapter]?.title}</p>
        </div>
        <div className="player-right-actions">
          <button onClick={() => notify('Bookmarked')} aria-label="Bookmark">
            <Bookmark size={17} />
          </button>
          <button onClick={() => notify('Downloaded')} aria-label="Download">
            <Download size={17} />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="player-progress-wrap">
        <span className="time-label">{formatTime(audioProgress)}</span>
        <div className="player-progress-track">
          <input
            type="range"
            min={0}
            max={100}
            value={audioProgress}
            onChange={e => dispatch({ type: 'SET_AUDIO_PROGRESS', payload: +e.target.value })}
            aria-label="Playback position"
          />
          <div className="player-progress-fill" style={{ width: `${audioProgress}%` }} />
        </div>
        <span className="time-label">6:22:00</span>
      </div>

      {/* Controls */}
      <div className="player-controls">
        <button onClick={() => notify('Rewound 10s')} aria-label="Rewind 10 seconds">
          <Rewind size={18} />
        </button>
        <button
          className="player-prev"
          onClick={() => setCurrentChapter(Math.max(0, currentChapter - 1))}
          aria-label="Previous chapter"
          disabled={currentChapter === 0}
        >
          <SkipBack size={22} />
        </button>
        <button
          className="play-main"
          onClick={() => dispatch({ type: 'SET_AUDIO_PLAYING', payload: !audioPlaying })}
          aria-label={audioPlaying ? 'Pause' : 'Play'}
        >
          {audioPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <button
          className="player-next"
          onClick={() => setCurrentChapter(Math.min(chapters.length - 1, currentChapter + 1))}
          aria-label="Next chapter"
          disabled={currentChapter === chapters.length - 1}
        >
          <SkipForward size={22} />
        </button>
        <button onClick={() => notify('Skipped 30s')} aria-label="Skip 30 seconds">
          <FastForward size={18} />
        </button>
      </div>

      {/* Speed & Volume */}
      <div className="player-footer">
        <div className="volume-ctrl">
          <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range" min={0} max={100} value={muted ? 0 : volume}
            onChange={e => { setVolume(+e.target.value); setMuted(false); }}
            aria-label="Volume"
            style={{ width: 90 }}
          />
          <span>{muted ? 0 : volume}%</span>
        </div>

        <div className="speed-ctrl">
          <button className="speed-btn" onClick={() => setSpeedOpen(!speedOpen)}>
            {audioSpeed}× <ChevronDown size={13} />
          </button>
          {speedOpen && (
            <div className="speed-dropdown">
              {SPEEDS.map(s => (
                <button
                  key={s}
                  className={audioSpeed === s ? 'active' : ''}
                  onClick={() => { dispatch({ type: 'SET_AUDIO_SPEED', payload: s }); setSpeedOpen(false); }}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="sleep-btn" onClick={() => notify('Sleep timer set for 30 min')}>
          <Clock size={15} /> Sleep
        </button>
      </div>

      {/* Chapter list */}
      <div className="player-chapters">
        <div className="eyebrow">CHAPTERS</div>
        <div className="chapter-list-scroll">
          {chapters.map((ch, i) => (
            <button
              key={ch.id || i}
              className={`chapter-row ${currentChapter === i ? 'active' : ''}`}
              onClick={() => { setCurrentChapter(i); dispatch({ type: 'SET_AUDIO_PROGRESS', payload: 0 }); }}
            >
              <span className="ch-num">0{i + 1}</span>
              <span className="ch-name">{ch.title}</span>
              <span className="ch-dur">{ch.duration}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Generate Audio ───────────────────────────────────────────────────────────
function GenerateAudioView({ doc, onGenerated }) {
  const { state, dispatch, notify } = useApp();
  const { audioTone } = state;
  const [step, setStep] = useState('tone'); // 'tone' | 'settings' | 'generating' | 'done'
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');

  const generate = async () => {
    setStep('generating');
    const stages = [
      { label: 'Extracting text...', pct: 20 },
      { label: 'Splitting chapters...', pct: 40 },
      { label: `Generating ${audioTone.toLowerCase()} narration...`, pct: 65 },
      { label: 'Normalizing audio...', pct: 85 },
      { label: 'Finalizing...', pct: 100 },
    ];
    for (const s of stages) {
      setStage(s.label);
      setProgress(s.pct);
      await new Promise(r => setTimeout(r, 700));
    }
    setStep('done');
    onGenerated();
  };

  if (step === 'generating') return (
    <div className="generating-view">
      <div className="gen-orb">
        <Headphones size={32} />
        <div className="gen-ring" />
      </div>
      <h3>Generating audiobook</h3>
      <p className="gen-stage">{stage}</p>
      <ProgressBar value={progress} />
      <small>{progress}% complete</small>
    </div>
  );

  if (step === 'done') return (
    <div className="generating-view success">
      <div className="gen-orb success">
        <Headphones size={32} />
      </div>
      <h3>Your audiobook is ready!</h3>
      <p>{doc.title} has been converted to a {audioTone.toLowerCase()} narration.</p>
      <button className="primary-button" onClick={() => setStep('player')}>
        <Play size={16} fill="currentColor" /> Play now
      </button>
    </div>
  );

  return (
    <div className="generate-view">
      <h3>Generate Audiobook</h3>
      <p className="gen-sub">Choose a narration tone for <strong>{doc?.title}</strong></p>

      <div className="tone-cards">
        {TONES.map(tone => (
          <button
            key={tone.id}
            className={`tone-card ${audioTone === tone.id ? 'selected' : ''}`}
            onClick={() => dispatch({ type: 'SET_AUDIO_TONE', payload: tone.id })}
          >
            <div className="tone-icon" style={{ color: tone.color }}>
              <tone.icon size={22} />
            </div>
            <div>
              <strong>{tone.label}</strong>
              <small>{tone.description}</small>
            </div>
            {tone.badge && <span className="tone-badge">{tone.badge}</span>}
          </button>
        ))}
      </div>

      <div className="gen-settings">
        <h4>Voice settings</h4>
        <div className="setting-rows">
          <label>Playback speed <select defaultValue="1.0"><option>1.0×</option><option>1.25×</option><option>1.5×</option></select></label>
          <label>Sleep timer <select defaultValue="off"><option value="off">Off</option><option>30 min</option><option>1 hr</option></select></label>
          <label>Auto-play next chapter <span className="switch"><i className="on" /></span></label>
        </div>
      </div>

      <button className="primary-button full-width" onClick={generate}>
        <Headphones size={16} /> Generate audiobook
      </button>
    </div>
  );
}

// ─── Main Audio Studio ────────────────────────────────────────────────────────
export default function AudioStudioPage() {
  const { state, notify } = useApp();
  const { documents, audiobooks } = state;
  const [tab, setTab] = useState('player'); // 'player' | 'generate' | 'saved' | 'collab'
  const [selectedDoc, setSelectedDoc] = useState(documents[0]);
  const [audioReady, setAudioReady] = useState(false);

  return (
    <div className="page-shell audio-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">AUDIO STUDIO</div>
          <h1>Your listening world.</h1>
        </div>
        <div className="top-actions">
          <button className="primary-button" onClick={() => setTab('generate')}>
            <Plus size={15} /> Generate audiobook
          </button>
        </div>
      </header>

      <div className="audio-tabs" role="tablist">
        {[
          { id: 'player', label: 'Player' },
          { id: 'generate', label: 'Generate' },
          { id: 'saved', label: 'Saved audiobooks' },
          { id: 'collab', label: 'Collaborative studio' },
        ].map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'selected' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'player' && (
        audiobooks.length > 0
          ? <AudioPlayer audiobook={audiobooks[0]} doc={documents.find(d => d.id === audiobooks[0].docId)} />
          : <EmptyState emoji="🎧" title="Turn a document into an audiobook." description="Generate your first audiobook to listen here." action="Generate audiobook" onAction={() => setTab('generate')} />
      )}

      {tab === 'generate' && (
        <div className="audio-generate-layout">
          <div className="gen-doc-picker">
            <div className="eyebrow">SELECT DOCUMENT</div>
            {documents.map(doc => (
              <button
                key={doc.id}
                className={`gen-doc-item ${selectedDoc?.id === doc.id ? 'selected' : ''}`}
                onClick={() => setSelectedDoc(doc)}
              >
                <div className={`mini-cover-sm cover-${doc.color}`}>{doc.coverSymbol}</div>
                <div>
                  <strong>{doc.title}</strong>
                  <small>{doc.author}</small>
                </div>
              </button>
            ))}
          </div>
          <GenerateAudioView doc={selectedDoc} onGenerated={() => { setAudioReady(true); notify('Audiobook ready! Switching to player.'); setTimeout(() => setTab('player'), 1200); }} />
        </div>
      )}

      {tab === 'saved' && (
        audiobooks.length > 0 ? (
          <div className="saved-audiobooks">
            {audiobooks.map(ab => {
              const doc = documents.find(d => d.id === ab.docId);
              return (
                <div key={ab.id} className="saved-ab-card">
                  <div className={`saved-ab-cover cover-${doc?.color}`}><Headphones size={24} /></div>
                  <div className="saved-ab-info">
                    <strong>{ab.title}</strong>
                    <small>{ab.tone} · {ab.duration}</small>
                    <ProgressBar value={ab.progress} thin />
                  </div>
                  <button className="play-circle" onClick={() => { setTab('player'); notify('Resuming playback'); }}>
                    <Play size={16} fill="currentColor" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState emoji="📼" title="No audiobooks yet." description="Generate your first audiobook and it will appear here." action="Generate" onAction={() => setTab('generate')} />
        )
      )}

      {tab === 'collab' && (
        <div className="collab-studio">
          <div className="collab-hero">
            <div className="collab-icon"><Users size={32} /></div>
            <div>
              <h3>Collaborative Audiobook Studio</h3>
              <p>Record with friends — assign chapters, record different voices, and stitch them into one audiobook.</p>
            </div>
          </div>
          <div className="collab-steps">
            {['Create project', 'Invite collaborators', 'Assign chapters', 'Record parts', 'AI cleanup & stitch', 'Publish'].map((step, i) => (
              <div key={step} className="collab-step">
                <div className="step-num">{i + 1}</div>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <button className="primary-button" onClick={() => notify('Collaborative studio — coming in Phase 4')}>
            <Plus size={15} /> Start a collaborative project
          </button>
        </div>
      )}
    </div>
  );
}
