// ─── Reader Page ──────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Bookmark, MoreHorizontal, Settings, BookOpen, Moon,
  AudioLines, Sparkles, Play, Clock3, ChevronLeft, ChevronRight,
  HighlighterIcon, StickyNote, Search, List, Volume2, VolumeX,
  Music, Leaf, CloudRain, Wind, Pause, Timer, ZapOff
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProgressBar } from '../components/ui';
import { READING_CONTENT, VIBE_PRESETS, ZEN_PRESETS } from '../data/mockData';

// ─── Mode Switcher ────────────────────────────────────────────────────────────
function ModeSwitcher({ mode, setMode }) {
  const modes = [
    { id: 'Reader', icon: BookOpen },
    { id: 'Zen', icon: Moon },
    { id: 'Vibe', icon: AudioLines },
  ];
  return (
    <div className="mode-switcher" role="tablist" aria-label="Reading mode">
      {modes.map(({ id, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={mode === id}
          className={mode === id ? 'active' : ''}
          onClick={() => setMode(id)}
        >
          <Icon size={14} />
          {id}
        </button>
      ))}
    </div>
  );
}

// ─── Zen Mode Controls ────────────────────────────────────────────────────────
function ZenControls({ state, dispatch }) {
  const { zenPreset, zenVolume, zenSound } = state;
  const [isPlaying, setIsPlaying] = useState(false);
  const [timer, setTimer] = useState(25);
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);

  const sounds = [
    { id: 'rain', label: 'Rain', icon: CloudRain },
    { id: 'forest', label: 'Forest', icon: Leaf },
    { id: 'focus', label: 'Focus', icon: Wind },
  ];

  useEffect(() => {
    let interval;
    if (timerActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(t => t - 1), 1000);
    } else if (timeLeft === 0) {
      setTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [timerActive, timeLeft]);

  const startTimer = () => {
    setTimeLeft(timer * 60);
    setTimerActive(true);
  };

  return (
    <div className="zen-controls">
      <div className="zen-sounds">
        {sounds.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`sound-btn ${zenSound === id ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ZEN_PRESET', payload: { ...ZEN_PRESETS.find(p => p.sound === id) || ZEN_PRESETS[0], sound: id } })}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="zen-volume">
        <VolumeX size={14} />
        <input
          type="range"
          min={0}
          max={100}
          value={zenVolume}
          onChange={e => dispatch({ type: 'SET_ZEN_VOLUME', payload: +e.target.value })}
          aria-label="Ambient volume"
        />
        <Volume2 size={14} />
        <span>{zenVolume}%</span>
      </div>
      <div className="zen-timer-row">
        <button
          className={`play-ambient ${isPlaying ? 'playing' : ''}`}
          onClick={() => setIsPlaying(!isPlaying)}
          aria-label={isPlaying ? 'Pause ambient sound' : 'Play ambient sound'}
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
        </button>
        <div className="timer-ctrl">
          <Timer size={14} />
          {timerActive ? (
            <span className="timer-countdown">
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
            </span>
          ) : (
            <select value={timer} onChange={e => setTimer(+e.target.value)} aria-label="Focus timer duration">
              {[15, 25, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          )}
          <button
            className="start-timer"
            onClick={timerActive ? () => { setTimerActive(false); setTimeLeft(null); } : startTimer}
          >
            {timerActive ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
      <div className="zen-presets">
        {ZEN_PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`zen-preset-btn ${zenPreset === preset.id ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_ZEN_PRESET', payload: preset })}
            title={preset.name}
          >
            <span>{preset.emoji}</span>
            <small>{preset.name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Vibe Controls ────────────────────────────────────────────────────────────
function VibeControls({ state, dispatch, isPlaying, onPlayingChange }) {
  const { vibePreset, vibeVolume, vibeTextContrast } = state;

  return (
    <div className="vibe-controls">
      <div className="vibe-now-playing">
        <Music size={14} />
        <div>
          <strong>Vibe stream · live</strong>
          <small>Ambient equalizer is moving automatically</small>
        </div>
        <button
          className={`play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={() => onPlayingChange(!isPlaying)}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
        </button>
      </div>
      <div className="vibe-presets-grid">
        {VIBE_PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`vibe-preset ${vibePreset === preset.id ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_VIBE_PRESET', payload: preset.id })}
            style={{ background: preset.gradient }}
          >
            <span>{preset.emoji}</span>
            <small>{preset.name}</small>
          </button>
        ))}
      </div>
      <div className="vibe-sliders">
        <label>
          <Volume2 size={13} /> Music volume
          <input type="range" min={0} max={100} value={vibeVolume}
            onChange={e => dispatch({ type: 'SET_VIBE_VOLUME', payload: +e.target.value })} />
          <span>{vibeVolume}%</span>
        </label>
        <label>
          <ZapOff size={13} /> Text contrast
          <input type="range" min={40} max={100} value={vibeTextContrast}
            onChange={e => dispatch({ type: 'SET_VIBE_TEXT_CONTRAST', payload: +e.target.value })} />
          <span>{vibeTextContrast}%</span>
        </label>
      </div>
    </div>
  );
}

function VibeEqualizer({ isPlaying }) {
  const columns = [
    7, 10, 13, 18, 25, 33, 42, 56, 72, 88, 62, 44, 31, 22, 35, 49,
    63, 52, 37, 25, 19, 28, 41, 57, 76, 92, 68, 47, 34, 24, 40, 55,
    71, 48, 30, 21, 29, 43, 59, 77, 94, 69, 51, 36, 26, 39, 58, 78,
  ];

  return (
    <div className={`vibe-equalizer ${isPlaying ? 'is-playing' : 'is-paused'}`} aria-hidden="true">
      <div className="vibe-equalizer-glow" />
      <div className="vibe-equalizer-grid">
        {columns.map((height, index) => (
          <div
            className="vibe-column"
            key={`${height}-${index}`}
            style={{ '--column-height': `${height}%`, '--column-delay': `${(index % 9) * -0.13}s` }}
          >
            {Array.from({ length: 18 }, (_, segment) => (
              <i key={segment} className={segment > 14 ? 'hot' : segment > 10 ? 'pink' : ''} />
            ))}
          </div>
        ))}
      </div>
      <div className="vibe-reflection" />
    </div>
  );
}

function ZenBackdrop() {
  return (
    <div className="zen-backdrop" aria-hidden="true">
      <div className="zen-sun" />
      <div className="zen-mountain zen-mountain-back" />
      <div className="zen-mountain zen-mountain-front" />
      <div className="zen-tree"><span /><i /><b /></div>
      <div className="zen-water"><div className="zen-waterline" /><div className="zen-waves" /></div>
      <div className="zen-mist" />
    </div>
  );
}

// ─── Chapter Nav ──────────────────────────────────────────────────────────────
function ChapterNav({ doc, activeChapter, setActiveChapter }) {
  return (
    <aside className="chapter-nav" aria-label="Table of contents">
      <div className="eyebrow">CONTENTS</div>
      <h3>Table of contents</h3>
      <nav>
        {doc.chapters.map((ch) => (
          <button
            key={ch.id}
            className={activeChapter === ch.id ? 'selected' : ''}
            onClick={() => setActiveChapter(ch.id)}
            aria-current={activeChapter === ch.id ? 'true' : undefined}
          >
            <span className="ch-num">0{ch.id}</span>
            <span className="ch-title">{ch.title}</span>
            <small className="ch-dur">{ch.duration}</small>
          </button>
        ))}
      </nav>
      <div className="reader-stat">
        <Clock3 size={14} />
        <div>
          <span>Today</span>
          <b>24 min</b>
        </div>
      </div>
    </aside>
  );
}

// ─── Context Rail ─────────────────────────────────────────────────────────────
function ContextRail({ doc, dispatch, notify }) {
  return (
    <aside className="context-rail">
      <div className="rail-card ai-card">
        <Sparkles size={16} />
        <strong>ReadVibe insight</strong>
        <p>Want to see how <b>affordances</b> apply to something you use every day?</p>
        <button onClick={() => dispatch({ type: 'SET_AI_OPEN', payload: true })}>
          Explore concept →
        </button>
      </div>
      <div className="rail-card">
        <div className="rail-head">
          <span>HIGHLIGHTS</span>
          <MoreHorizontal size={14} />
        </div>
        {doc.highlights.map(h => (
          <div key={h.id} className={`highlight-line ${h.category === 'Definition' ? 'yellow' : ''}`}>
            <i />
            <div>
              <p>"{h.text}"</p>
              <small>{h.category} · {h.time}</small>
            </div>
          </div>
        ))}
        <button className="text-button small" onClick={() => notify('Notebook opened')}>
          Open notebook →
        </button>
      </div>
    </aside>
  );
}

// ─── Text Selection Toolbar ───────────────────────────────────────────────────
function SelectionToolbar({ pos, onAction }) {
  if (!pos) return null;
  return (
    <div className="selection-toolbar" style={{ top: pos.y, left: pos.x }}>
      {[
        { label: 'Explain', icon: Sparkles },
        { label: 'Highlight', icon: HighlighterIcon },
        { label: 'Note', icon: StickyNote },
        { label: 'Define', icon: Search },
      ].map(({ label, icon: Icon }) => (
        <button key={label} onClick={() => onAction(label)}>
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}

// ─── Reading Surface ──────────────────────────────────────────────────────────
function ReadingSurface({ doc, activeChapter, onAI, notify }) {
  const [selectionPos, setSelectionPos] = useState(null);
  const chapter = doc.chapters.find(c => c.id === activeChapter) || doc.chapters[0];

  const handleMouseUp = (e) => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 5) {
    }
  };

  const handleSelectionAction = (action) => {
    setSelectionPos(null);
    if (action === 'Explain') onAI();
    else notify(`"${window.getSelection()?.toString()?.substring(0, 30)}..." ${action.toLowerCase()}ed`);
  };

  return (
    <article
      className="reading-surface"
      onMouseUp={handleMouseUp}
      onClick={() => !selectionPos && setSelectionPos(null)}
    >
      <SelectionToolbar pos={selectionPos} onAction={handleSelectionAction} />
      <div className="chapter-label">
        CHAPTER 0{activeChapter} <span>•</span> {chapter.title.toUpperCase()}
      </div>
      <h2>
        Knowledge in the world<br />
        <em>and in the head</em>
      </h2>
      <div className="reading-meta">
        <span>{doc.author}</span>
        <span>·</span>
        <span>{chapter.duration} read</span>
        <button className="meta-settings" onClick={() => notify('Reading settings opened')}>
          <Settings size={13} /> Aa
        </button>
      </div>
      <div className="article-copy">
        <p className="dropcap">T</p>
        {READING_CONTENT.trim().split('\n\n').map((para, i) => {
          if (para.trim().startsWith('"') && para.trim().endsWith('"')) {
            return <blockquote key={i}>{para.trim()}</blockquote>;
          }
          return <p key={i}>{para.trim().replace(/affordances/g, 'affordances').split('affordances').map((part, j, arr) => (
            j < arr.length - 1
              ? <React.Fragment key={j}>{part}<mark>affordances</mark></React.Fragment>
              : part
          ))}</p>;
        })}
      </div>
      <div className="reader-footer">
        <span>{doc.currentPage}</span>
        <ProgressBar value={doc.progress} className="reader-progress" />
        <span>{doc.totalPages}</span>
        <button className="ai-reader-button" onClick={onAI}>
          <Sparkles size={14} /> Ask AI
        </button>
        <button className="audio-mini" onClick={() => notify('Audio player started')}>
          <Play size={13} fill="currentColor" /> Listen
        </button>
      </div>
    </article>
  );
}

// ─── Reader Page ──────────────────────────────────────────────────────────────
export default function ReaderPage() {
  const { state, dispatch, notify } = useApp();
  const { activeDoc, readerMode } = state;
  const [activeChapter, setActiveChapter] = useState(
    activeDoc.chapters.find((_, i) => i === 5)?.id || activeDoc.chapters[0].id
  );
  const [vibePlaying, setVibePlaying] = useState(true);

  const setMode = (mode) => dispatch({ type: 'SET_READER_MODE', payload: mode });
  const openAI = () => dispatch({ type: 'SET_AI_OPEN', payload: true });

  // Current vibe background
  const currentVibe = VIBE_PRESETS.find(v => v.id === state.vibePreset) || VIBE_PRESETS[0];
  const currentZen = ZEN_PRESETS.find(z => z.id === state.zenPreset) || ZEN_PRESETS[0];

  const pageStyle = readerMode === 'Zen'
    ? { background: currentZen.gradient }
    : readerMode === 'Vibe'
    ? { background: currentVibe.gradient }
    : {};

  return (
    <div
      className={`reader-page mode-${readerMode.toLowerCase()}`}
      style={pageStyle}
    >
      {readerMode === 'Zen' && <ZenBackdrop />}
      {readerMode === 'Vibe' && <VibeEqualizer isPlaying={vibePlaying} />}
      {/* Top bar */}
      <div className="reader-top">
        <button
          className="back-button"
          onClick={() => dispatch({ type: 'SET_PAGE', payload: 'library' })}
          aria-label="Back to library"
        >
          <ArrowLeft size={17} />
        </button>
        <div className="reader-title">
          <span>{activeDoc.type} · {activeDoc.tag}</span>
          <strong>{activeDoc.title}</strong>
        </div>
        <div className="reader-actions">
          <button onClick={() => notify('Bookmark saved')} aria-label="Bookmark">
            <Bookmark size={17} />
          </button>
          <button onClick={() => notify('Search in document')} aria-label="Search">
            <Search size={17} />
          </button>
          <button onClick={() => notify('More options')} aria-label="More options">
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <ModeSwitcher mode={readerMode} setMode={setMode} />

      {/* Main layout */}
      <div className="reader-layout">
        <ChapterNav
          doc={activeDoc}
          activeChapter={activeChapter}
          setActiveChapter={setActiveChapter}
        />

        <ReadingSurface
          doc={activeDoc}
          activeChapter={activeChapter}
          onAI={openAI}
          notify={notify}
        />

        {readerMode === 'Reader' && (
          <ContextRail doc={activeDoc} dispatch={dispatch} notify={notify} />
        )}
        {readerMode === 'Zen' && (
          <div className="zen-rail">
            <ZenControls state={state} dispatch={dispatch} />
          </div>
        )}
        {readerMode === 'Vibe' && (
          <div className="vibe-rail">
            <VibeControls
              state={state}
              dispatch={dispatch}
              isPlaying={vibePlaying}
              onPlayingChange={setVibePlaying}
            />
          </div>
        )}
      </div>
    </div>
  );
}
