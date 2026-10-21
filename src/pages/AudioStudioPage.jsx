// ─── Audio Studio ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Bookmark, Check, ChevronDown, Clock, Download, FastForward, Headphones, Loader2, Pause, Play, Plus,
  Rewind, SkipBack, SkipForward, Smile, Trash2, Users, Volume2, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { formatClock, formatDuration, timeAgo } from '../lib/format';
import { loadVoices, Narrator, pickVoice, speak, speechSupported } from '../lib/speech';
import { Cover, EmptyState, ErrorState, Menu, PageLoader, ProgressBar, Skeleton, Switch, Tabs } from '../components/ui';
import CollabStudio from '../components/audio/CollabStudio';

const TONE_META = {
  Regular: { icon: BookOpen, badge: 'Most used', color: 'var(--accent)' },
  Humor: { icon: Smile, badge: 'Fan favorite', color: 'var(--green)' },
  Tough: { icon: Zap, badge: 'Study mode', color: 'var(--purple)' },
};
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP = [0, 15, 30, 45, 60, -1];

function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => { loadVoices().then(setVoices); }, []);
  return voices;
}

// ─── Player ───────────────────────────────────────────────────────────────────
function Player({ bookId, onBack }) {
  const { prefs, setPrefs, notify } = useApp();
  const voices = useVoices();
  const book = useQuery(() => api.audio.get(bookId), [bookId]);
  const narrator = useMemo(() => new Narrator(), []);
  const [st, setSt] = useState(narrator.state());
  const [charIndex, setCharIndex] = useState(null);
  const [rate, setRate] = useState(prefs.audio.rate);
  const [sleep, setSleep] = useState(prefs.audio.sleepTimer || 0);
  const [sleepLeft, setSleepLeft] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const listened = useRef(0);
  const saveRef = useRef(null);

  useEffect(() => () => narrator.destroy(), [narrator]);
  useEffect(() => narrator.on((s) => {
    setSt(s);
    setCharIndex(s.charIndex ?? null);
    if (s.chapterEnded != null && sleep === -1) { narrator.pause(); notify('Sleep timer: stopped at the end of the chapter', 'info'); setSleep(0); }
    if (s.finished) notify('Audiobook finished 🎧');
  }), [narrator, sleep, notify]);

  // load script once book + voices are known
  useEffect(() => {
    const b = book.data;
    if (!b || b.status !== 'ready') return;
    const voice = pickVoice(voices, b.voice || prefs.audio.voice, b.tone);
    narrator.load(b.script, { rate: b.rate * rate, pitch: b.pitch, voice, chapter: b.position_chapter, segment: b.position_segment });
    narrator.autoAdvance = prefs.audio.autoAdvance;
    setBookmarks(b.bookmarks || []);
    totalListened.current = b.listened_seconds || 0;
  }, [book.data, voices.length]); // eslint-disable-line

  // persist position
  const totalListened = useRef(0);
  const persist = useCallback(() => {
    if (!book.data) return;
    const secs = Math.round(listened.current);
    listened.current = 0;
    totalListened.current += secs;
    api.audio.update(bookId, {
      position_chapter: narrator.chapter, position_segment: narrator.segment, listened_seconds: totalListened.current,
    }).catch(() => {});
    if (secs >= 20) api.activity.logSession({ document_id: book.data.document_id, kind: 'listening', mode: 'Audio', seconds: secs }).catch(() => {});
  }, [book.data, bookId, narrator]);

  useEffect(() => {
    if (!st.playing) { if (book.data) persist(); return undefined; }
    const t = setInterval(() => { listened.current += 1; }, 1000);
    saveRef.current = setInterval(persist, 15000);
    return () => { clearInterval(t); clearInterval(saveRef.current); };
  }, [st.playing]); // eslint-disable-line
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => () => persistRef.current(), []);

  // sleep timer
  useEffect(() => {
    if (sleep > 0) setSleepLeft(sleep * 60); else setSleepLeft(null);
  }, [sleep]);
  useEffect(() => {
    if (sleepLeft == null || !st.playing) return undefined;
    if (sleepLeft <= 0) { narrator.pause(); setSleep(0); notify('Sleep timer ended — playback paused', 'info'); return undefined; }
    const t = setTimeout(() => setSleepLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [sleepLeft, st.playing, narrator, notify]);

  // live elapsed time while playing
  const [, force] = useState(0);
  useEffect(() => {
    if (!st.playing) return undefined;
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [st.playing]);

  // keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); narrator.toggle(); }
      if (e.key === 'ArrowLeft') narrator.skip(-10);
      if (e.key === 'ArrowRight') narrator.skip(30);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrator]);

  if (book.error) return <ErrorState error={book.error} onRetry={book.reload} />;
  if (!book.data) return <PageLoader label="Loading audiobook…" />;
  const b = book.data;
  if (b.status !== 'ready') return <EmptyState icon={Loader2} title="Still generating…" description="This audiobook is being prepared. You’ll get a notification when it’s ready." />;
  if (!speechSupported) return <ErrorState error={{ message: 'This browser has no speech engine. Try Chrome, Edge or Safari, or download the narration script.' }} />;

  const elapsed = narrator.elapsedSeconds;
  const total = narrator.totalSeconds || b.duration_seconds;
  const changeRate = (r) => {
    setRate(r);
    setPrefs({ audio: { rate: r } });
    narrator.setRate(b.rate * r);
  };
  const changeVoice = (name) => {
    const v = voices.find((x) => x.name === name);
    narrator.setVoice(v);
    api.audio.update(bookId, { voice: name }).catch(() => {});
  };
  const addBookmark = () => {
    const mark = { id: Date.now(), chapter: narrator.chapter, segment: narrator.segment, label: `${st.chapterTitle} · ${formatClock(elapsed)}`, text: st.text.slice(0, 80) };
    const next = [...bookmarks, mark];
    setBookmarks(next);
    api.audio.update(bookId, { bookmarks: next }).then(() => notify('Bookmark added')).catch((e) => notify(e.message, 'error'));
  };
  const removeBookmark = (id) => {
    const next = bookmarks.filter((m) => m.id !== id);
    setBookmarks(next);
    api.audio.update(bookId, { bookmarks: next }).catch(() => {});
  };
  const current = st.text || b.script[st.chapter]?.segments[st.segment]?.text || '';
  const voiceName = narrator.voice?.name || '';

  return (
    <div className="audio-player">
      <div className="player-track">
        <div className={`player-cover cover-${b.color}`}><Headphones size={30} /><span className="tone-tag">{b.tone}</span></div>
        <div className="player-info">
          <div className="eyebrow">NOW PLAYING</div>
          <h3>{b.title}</h3>
          <p>{b.tone} narration · {st.chapterTitle}</p>
        </div>
        <div className="player-right-actions">
          <button onClick={addBookmark} aria-label="Bookmark this moment"><Bookmark size={17} /></button>
          <button onClick={() => api.audio.downloadScript(bookId).catch((e) => notify(e.message, 'error'))} aria-label="Download narration script"><Download size={17} /></button>
        </div>
      </div>

      <div className="now-reading" aria-live="off">
        {charIndex != null && current
          ? <>{current.slice(0, charIndex)}<mark>{current.slice(charIndex).split(/\s/)[0]}</mark>{current.slice(charIndex + (current.slice(charIndex).split(/\s/)[0] || '').length)}</>
          : current}
      </div>

      <div className="player-progress-wrap">
        <span className="time-label">{formatClock(elapsed)}</span>
        <input type="range" className="seek" min={0} max={Math.max(1, Math.round(total))} value={Math.round(elapsed)} aria-label="Seek"
          onChange={(e) => narrator.seekTime(+e.target.value)} style={{ '--fill': `${(elapsed / Math.max(1, total)) * 100}%` }} />
        <span className="time-label">-{formatClock(total - elapsed)}</span>
      </div>

      <div className="player-controls">
        <button onClick={() => narrator.skip(-10)} aria-label="Back 10 seconds" title="Back 10s (←)"><Rewind size={18} /><small>10</small></button>
        <button onClick={() => narrator.seek(narrator.segment > 2 ? narrator.chapter : narrator.chapter - 1, 0)} aria-label="Previous chapter" disabled={st.chapter === 0 && st.segment < 3}><SkipBack size={22} /></button>
        <button className="play-main" onClick={() => narrator.toggle()} aria-label={st.playing ? 'Pause' : 'Play'}>
          {st.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <button onClick={() => narrator.seek(narrator.chapter + 1, 0)} aria-label="Next chapter" disabled={st.chapter >= b.script.length - 1}><SkipForward size={22} /></button>
        <button onClick={() => narrator.skip(30)} aria-label="Forward 30 seconds" title="Forward 30s (→)"><FastForward size={18} /><small>30</small></button>
      </div>

      <div className="player-footer">
        <Menu trigger={<span className="speed-btn">{rate}× <ChevronDown size={13} /></span>} label="Playback speed" align="up"
          items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === rate, onClick: () => changeRate(s) }))} />
        {voices.length > 0 && (
          <select className="voice-select" value={voiceName} onChange={(e) => changeVoice(e.target.value)} aria-label="Voice">
            {voices.filter((v) => /^en/i.test(v.lang) || v.name === voiceName).map((v) => <option key={v.name} value={v.name}>{v.name.replace(/Microsoft |Google /, '')}</option>)}
          </select>
        )}
        <Menu trigger={<span className={`sleep-btn ${sleep ? 'on' : ''}`}><Clock size={14} /> {sleep === -1 ? 'End of chapter' : sleepLeft != null ? formatClock(sleepLeft) : 'Sleep'}</span>} label="Sleep timer" align="up"
          items={SLEEP.map((m) => ({ label: m === 0 ? 'Off' : m === -1 ? 'End of chapter' : `${m} minutes`, checked: sleep === m, onClick: () => setSleep(m) }))} />
      </div>

      <div className="player-columns">
        <div className="player-chapters">
          <div className="eyebrow">CHAPTERS</div>
          <div className="chapter-list-scroll">
            {b.script.map((ch, i) => (
              <button key={i} className={`chapter-row ${st.chapter === i ? 'active' : ''}`} onClick={() => { narrator.seek(i, 0); if (!st.playing) narrator.play(); }}>
                <span className="ch-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ch-name">{ch.title}</span>
                <span className="ch-dur">{formatDuration(narrator.chapterSeconds(i))}</span>
                {st.chapter === i && st.playing && <span className="eq-mini" aria-hidden="true"><i /><i /><i /></span>}
              </button>
            ))}
          </div>
        </div>
        <div className="player-bookmarks">
          <div className="eyebrow">BOOKMARKS</div>
          {bookmarks.length === 0 && <p className="muted small">Tap the bookmark icon to save a moment.</p>}
          {bookmarks.map((m) => (
            <div key={m.id} className="bookmark-line">
              <button onClick={() => narrator.seek(m.chapter, m.segment)}><Bookmark size={12} /> <span>{m.label}<small>{m.text}</small></span></button>
              <button className="icon-ghost sm" onClick={() => removeBookmark(m.id)} aria-label="Remove bookmark"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>
      {onBack && <button className="text-button" onClick={onBack}>← All audiobooks</button>}
    </div>
  );
}

// ─── Generate ─────────────────────────────────────────────────────────────────
function Generate({ initialDoc, onReady }) {
  const { prefs, setPrefs, notify, trackJob } = useApp();
  const voices = useVoices();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  const tones = useQuery(() => api.audio.tones(), []);
  const ready = (docs.data || []).filter((d) => d.status === 'ready');
  const [docId, setDocId] = useState(initialDoc);
  const selectedId = docId || ready[0]?.id;
  const detail = useQuery(() => (selectedId ? api.documents.get(selectedId) : null), [selectedId]);
  const [tone, setTone] = useState(prefs.audio.tone);
  const [voice, setVoice] = useState(prefs.audio.voice);
  const [rate, setRate] = useState(1);
  const [chapters, setChapters] = useState(null);
  const [job, setJob] = useState(null);
  const [previewing, setPreviewing] = useState(null);

  useEffect(() => setChapters(null), [selectedId]);
  const allIdx = (detail.data?.chapters || []).map((c) => c.index);
  const chosen = chapters ?? allIdx;

  const preview = (t) => {
    const cfg = tones.data?.find((x) => x.id === t);
    if (!cfg) return;
    setPreviewing(t);
    const v = pickVoice(voices, voice, t);
    const text = detail.data ? `${cfg.preview} Here's how “${detail.data.title}” will sound.` : cfg.preview;
    speak(text, { rate: cfg.rate * rate, pitch: cfg.pitch, voice: v, onEnd: () => setPreviewing(null) });
  };

  const generate = async () => {
    try {
      setPrefs({ audio: { tone, voice } });
      const res = await api.audio.create({ document_id: selectedId, tone, voice: voice || null, rate, chapter_indexes: chosen.length === allIdx.length ? null : chosen });
      setJob({ id: res.job_id, progress: 0, stage: 'Queued', bookId: res.audiobook.id });
      const poll = setInterval(async () => {
        try {
          const j = await api.activity.job(res.job_id);
          setJob((s) => (s ? { ...s, progress: j.progress, stage: j.stage, status: j.status } : s));
          if (j.status === 'completed' || j.status === 'failed') clearInterval(poll);
        } catch { clearInterval(poll); }
      }, 600);
      trackJob(res.job_id, (j) => {
        if (j.status === 'completed') notify(`Your ${tone.toLowerCase()} audiobook is ready`, 'success', { action: { label: 'Play', onClick: () => onReady(res.audiobook.id) } });
        else notify(j.error || 'Audiobook generation failed', 'error');
      });
    } catch (err) { notify(err.message, 'error'); }
  };

  if (job) {
    const done = job.status === 'completed';
    return (
      <div className={`generating-view ${done ? 'success' : ''}`}>
        <div className={`gen-orb ${done ? 'success' : ''}`}><Headphones size={30} />{!done && <span className="gen-ring" />}</div>
        <h3>{done ? 'Your audiobook is ready!' : 'Generating audiobook'}</h3>
        <p className="gen-stage">{done ? `${detail.data?.title} · ${tone} narration` : job.stage}</p>
        {!done && <><ProgressBar value={job.progress} /><small>{Math.round(job.progress)}% · keeps running if you leave this page</small></>}
        {job.status === 'failed' && <p className="field-error">Generation failed. Please try again.</p>}
        <div className="gen-actions">
          {done && <button className="primary-button" onClick={() => onReady(job.bookId)}><Play size={15} fill="currentColor" /> Play now</button>}
          <button className="secondary-button" onClick={() => setJob(null)}>Generate another</button>
        </div>
      </div>
    );
  }

  if (docs.loading && !docs.data) return <Skeleton h={300} />;
  if (!ready.length) return <EmptyState icon={BookOpen} title="Add a document first" description="Upload a document, then turn it into an audiobook here." />;

  return (
    <div className="audio-generate-layout">
      <div className="gen-doc-picker">
        <div className="eyebrow">1 · SELECT DOCUMENT</div>
        <div className="gen-doc-list">
          {ready.map((d) => (
            <button key={d.id} className={`gen-doc-item ${selectedId === d.id ? 'selected' : ''}`} onClick={() => setDocId(d.id)} aria-pressed={selectedId === d.id}>
              <Cover doc={d} size="sm" />
              <span><strong>{d.title}</strong><small>{d.author} · {d.chapter_count} chapters</small></span>
              {d.audio_ready && <Headphones size={13} className="audio-icon" aria-label="Has an audiobook" />}
            </button>
          ))}
        </div>
      </div>
      <div className="generate-view">
        <div className="eyebrow">2 · CHOOSE A VOICE PERSONALITY</div>
        <div className="tone-cards">
          {(tones.data || []).map((t) => {
            const meta = TONE_META[t.id];
            return (
              <div key={t.id} className={`tone-card ${tone === t.id ? 'selected' : ''}`}>
                <button className="tone-main" onClick={() => setTone(t.id)} aria-pressed={tone === t.id}>
                  <span className="tone-icon" style={{ color: meta.color }}><meta.icon size={20} /></span>
                  <span><strong>{t.id}</strong><small>{t.description}</small></span>
                  <span className="tone-badge">{meta.badge}</span>
                </button>
                <button className="tone-preview" onClick={() => preview(t.id)} disabled={!speechSupported}>
                  {previewing === t.id ? <Volume2 size={13} className="pulse-icon" /> : <Play size={12} fill="currentColor" />} Preview
                </button>
              </div>
            );
          })}
        </div>

        <div className="eyebrow">3 · SETTINGS</div>
        <div className="gen-settings">
          {voices.length > 0 && (
            <label className="setting-line">Voice
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                <option value="">Best match for tone</option>
                {voices.filter((v) => /^en/i.test(v.lang)).map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </label>
          )}
          <label className="setting-line">Base speed
            <select value={rate} onChange={(e) => setRate(+e.target.value)}>{[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          </label>
          <Switch label="Auto-play next chapter" checked={prefs.audio.autoAdvance} onChange={(v) => setPrefs({ audio: { autoAdvance: v } })} />
          {detail.data && (
            <details className="chapter-picker">
              <summary>Chapters: {chosen.length === allIdx.length ? 'all' : `${chosen.length} of ${allIdx.length}`}</summary>
              <div className="chapter-picker-actions">
                <button className="text-button" onClick={() => setChapters(allIdx)}>Select all</button>
                <button className="text-button" onClick={() => setChapters([])}>None</button>
              </div>
              {detail.data.chapters.map((c) => (
                <label key={c.index} className="check-line">
                  <input type="checkbox" checked={chosen.includes(c.index)} onChange={(e) => setChapters(e.target.checked ? [...chosen, c.index].sort((a, b) => a - b) : chosen.filter((x) => x !== c.index))} />
                  {c.index + 1}. {c.title} <small>{c.minutes} min</small>
                </label>
              ))}
            </details>
          )}
        </div>
        {!speechSupported && <p className="field-error">This browser can’t speak text aloud — you can still generate and download the script.</p>}
        <button className="primary-button full-width" onClick={generate} disabled={!selectedId || chosen.length === 0}>
          <Headphones size={16} /> Generate {tone.toLowerCase()} audiobook
        </button>
      </div>
    </div>
  );
}

// ─── Saved ────────────────────────────────────────────────────────────────────
function Saved({ onPlay, onGenerate }) {
  const { notify, confirm, dataVersion } = useApp();
  const books = useQuery(() => api.audio.list(), [dataVersion]);
  if (books.error) return <ErrorState error={books.error} onRetry={books.reload} />;
  if (!books.data) return <Skeleton h={200} />;
  if (!books.data.length) return <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Generated audiobooks appear here and remember where you stopped." action="Generate audio" onAction={onGenerate} />;
  const remove = async (b) => {
    if (!(await confirm({ title: `Delete the ${b.tone} audiobook of “${b.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    await api.audio.remove(b.id).catch((e) => notify(e.message, 'error'));
    books.setData((l) => l.filter((x) => x.id !== b.id));
  };
  return (
    <div className="saved-audiobooks">
      {books.data.map((b) => (
        <div key={b.id} className="saved-ab-card">
          <div className={`saved-ab-cover cover-${b.color}`}><Headphones size={22} /></div>
          <div className="saved-ab-info">
            <strong>{b.title}</strong>
            <small>{b.tone} · {formatDuration(b.duration_seconds)} · {b.chapters.length} chapters · {timeAgo(b.created_at)}</small>
            <ProgressBar value={b.progress} thin />
          </div>
          {b.status === 'ready' ? (
            <button className="play-circle" onClick={() => onPlay(b.id)} aria-label={`Play ${b.title}`}><Play size={15} fill="currentColor" /></button>
          ) : <span className="status processing"><Loader2 size={13} className="spin" /> {b.status}</span>}
          <Menu trigger={<span className="icon-ghost sm">⋯</span>} items={[
            { label: 'Download script', icon: Download, onClick: () => api.audio.downloadScript(b.id) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(b) },
          ]} />
        </div>
      ))}
    </div>
  );
}

export default function AudioStudioPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const books = useQuery(() => api.audio.list(), []);
  const tab = params.get('tab') || (params.get('book') ? 'player' : 'player');
  const bookId = params.get('book') || (books.data || []).find((b) => b.status === 'ready')?.id;
  const setTab = (t) => setParams(t === 'player' && bookId ? { tab: t, book: bookId } : { tab: t });
  const play = (id) => setParams({ tab: 'player', book: id });

  return (
    <div className="page-shell audio-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">AUDIO STUDIO</div>
          <h1>Your listening world.</h1>
        </div>
        <div className="top-actions">
          <button className="primary-button" onClick={() => setTab('generate')}><Plus size={15} /> Generate audiobook</button>
        </div>
      </header>

      <Tabs value={tab} onChange={setTab} className="library-tabs" tabs={[
        { id: 'player', label: 'Player', icon: Headphones },
        { id: 'generate', label: 'Generate', icon: Plus },
        { id: 'saved', label: 'Saved audiobooks', count: books.data?.length || undefined },
        { id: 'collab', label: 'Collaborative studio', icon: Users },
      ]} />

      {tab === 'player' && (
        bookId ? <Player key={bookId} bookId={bookId} />
          : books.loading ? <Skeleton h={300} />
          : <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Choose humor, tough or regular narration — ReadVibe prepares it in the background." action="Generate audiobook" onAction={() => setTab('generate')} />
      )}
      {tab === 'generate' && <Generate initialDoc={params.get('doc')} onReady={(id) => { books.reload(); play(id); }} />}
      {tab === 'saved' && <Saved onPlay={play} onGenerate={() => setTab('generate')} />}
      {tab === 'collab' && <CollabStudio onOpenDoc={(id) => navigate(`/read/${id}`)} />}
      {tab === 'player' && <p className="fineprint"><Check size={11} /> Narration uses your device’s speech engine, so it works offline. Shortcuts: Space play/pause · ← back 10s · → forward 30s.</p>}
    </div>
  );
}
