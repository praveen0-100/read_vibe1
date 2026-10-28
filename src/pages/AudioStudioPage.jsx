// ─── Audio Studio ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Bookmark, Check, ChevronDown, Clock, Download, FastForward, Headphones, ListMusic, ListPlus, Loader2, Pause, Play, Plus,
  Quote, Repeat, Repeat1, Rewind, Shuffle, SkipBack, SkipForward, Smile, Trash2, Users, Volume2, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { formatClock, formatDuration } from '../lib/format';
import { playlistActions, usePlaylists } from '../lib/playlists';
import { queueActions, slim, useQueue } from '../lib/queue';
import { detectLanguage, speechTag } from '../lib/languages';
import { loadVoices, Narrator, pickVoice, pickVoiceForLang, speak, speechSupported } from '../lib/speech';
import { useNaturalVoice } from '../hooks/useNaturalVoice';
import { useScriptTranslation } from '../hooks/useScriptTranslation';
import ReadLanguage from '../components/reader/ReadLanguage';
import { Cover, EmptyState, ErrorState, Menu, PageLoader, ProgressBar, Skeleton, Switch, Tabs } from '../components/ui';
import AlbumArt from '../components/audio/AlbumArt';
import CollabStudio from '../components/audio/CollabStudio';
import LyricsView from '../components/audio/LyricsView';
import ReaderView from '../components/audio/ReaderView';
import { AlbumGrid, NewPlaylistModal, PlaylistsView } from '../components/audio/LibraryViews';
import QueuePanel from '../components/audio/QueuePanel';
import PowerSeek from '../components/audio/PowerSeek';

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
function Player({ bookId, visible = true, autoplay = false, startChapter = null, library = [], onNavigate, onOpen, onNewPlaylist, onPlayingChange }) {
  const { prefs, setPrefs, notify } = useApp();
  const { queue, history, shuffle, repeat } = useQueue();
  const { lists } = usePlaylists();
  const voices = useVoices();
  const book = useQuery(() => api.audio.get(bookId), [bookId]);
  const narrator = useMemo(() => new Narrator(), []);
  const [st, setSt] = useState(narrator.state());
  const [charIndex, setCharIndex] = useState(null);
  const [view, setView] = useState('listen'); // listen | transcript | reader
  const [rate, setRate] = useState(prefs.audio.rate);
  const [sleep, setSleep] = useState(prefs.audio.sleepTimer || 0);
  const [sleepLeft, setSleepLeft] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const listened = useRef(0);
  const saveRef = useRef(null);
  const autoplayed = useRef(false);
  const nv = useNaturalVoice();
  const [tlang, setTlangState] = useState(() => { try { return localStorage.getItem('readvibe.audiolang') || 'orig'; } catch { return 'orig'; } });
  const setTlang = (code) => { setTlangState(code); try { localStorage.setItem('readvibe.audiolang', code); } catch { /* private mode */ } };
  const sourceLang = useMemo(() => detectLanguage((book.data?.script || []).slice(0, 2).flatMap((c) => c.segments.slice(0, 20).map((x) => x.text)).join(' ')), [book.data]);
  const { script: viewScript, status: tr } = useScriptTranslation(book.data?.script, tlang, sourceLang);
  const viewLang = tr.ready ? tlang : sourceLang;
  useEffect(() => { if (tr.error) notify(`Translation failed: ${tr.error}`, 'error'); }, [tr.error]); // eslint-disable-line
  useEffect(() => { if (tr.note) notify(tr.note, 'warning'); }, [tr.note]); // eslint-disable-line

  useEffect(() => () => narrator.destroy(), [narrator]);
  // goes to the next album in the queue; returns false when there is none
  const goNext = useRef(() => false);
  goNext.current = (auto) => {
    if (!book.data) return false;
    const id = queueActions.advance(book.data, { auto });
    if (!id) return false;
    onNavigate(id, { autoplay: true });
    return true;
  };
  useEffect(() => narrator.on((s) => {
    setSt(s);
    setCharIndex(s.charIndex ?? null);
    if (s.error === 'no-voice') notify('Couldn’t reach the natural voice for this language, and this device has no voice for it. Try again in a moment, or install the language’s voice in your system settings.', 'warning');
    else if (s.neuralFailed) notify('Natural voices are unavailable right now — using your device voice.', 'info');
    else if (s.error) notify('Playback failed — check your connection and press play again.', 'warning');
    if (s.chapterEnded != null && sleep === -1) { narrator.pause(); notify('Sleep timer: stopped at the end of the chapter', 'info'); setSleep(0); }
    if (s.finished) {
      if (sleep === -1) { setSleep(0); notify('Sleep timer: stopped at the end of the audiobook', 'info'); return; }
      if (!goNext.current(true)) notify('Audiobook finished 🎧');
    }
  }), [narrator, sleep, notify]);

  const playingNow = !!st.playing;
  useEffect(() => { onPlayingChange?.(playingNow); }, [playingNow]); // eslint-disable-line

  // load script once book + voices are known
  useEffect(() => {
    const b = book.data;
    if (!b || b.status !== 'ready') return;
    const foreign = viewLang !== 'en';
    const voice = foreign ? pickVoiceForLang(voices, viewLang) : pickVoice(voices, b.voice || prefs.audio.voice, b.tone);
    // a re-load (translation arrived, voices appeared) keeps the listener's place and keeps playing
    const live = narrator.script.length > 0;
    const wasPlaying = live && narrator.playing;
    narrator.load(viewScript, {
      rate: b.rate * rate, pitch: b.pitch, voice, lang: speechTag(viewLang), neural: foreign ? nv.neuralFor(viewLang) : null,
      chapter: live ? narrator.chapter : (startChapter ?? b.position_chapter), segment: live ? narrator.segment : (startChapter != null ? 0 : b.position_segment),
    });
    if (wasPlaying) narrator.play();
    narrator.autoAdvance = prefs.audio.autoAdvance;
    if (autoplay && !autoplayed.current) { autoplayed.current = true; narrator.play(); }
    setBookmarks(b.bookmarks || []);
    totalListened.current = b.listened_seconds || 0;
  }, [book.data, voices.length, viewScript, viewLang, nv.languages.length, nv.on]); // eslint-disable-line

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
    if (!visible) return undefined;
    const onKey = (e) => {
      if (/input|textarea|select|button/i.test(e.target.tagName) && e.key === ' ') return;
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); narrator.toggle(); }
      if (e.key === 'ArrowLeft') narrator.skip(-10);
      if (e.key === 'ArrowRight') narrator.skip(30);
      if (e.key.toLowerCase() === 'n' && e.shiftKey) goNext.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrator, visible]);

  // lock-screen / headset / browser media keys + "now playing" card
  useEffect(() => {
    const b = book.data;
    if (!b || !('mediaSession' in navigator)) return undefined;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new window.MediaMetadata({ title: st.chapterTitle || b.title, artist: `${b.tone} narration`, album: b.title });
      ms.playbackState = st.playing ? 'playing' : 'paused';
      ms.setActionHandler('play', () => narrator.play());
      ms.setActionHandler('pause', () => narrator.pause());
      ms.setActionHandler('seekbackward', () => narrator.skip(-10));
      ms.setActionHandler('seekforward', () => narrator.skip(30));
      ms.setActionHandler('previoustrack', () => (narrator.chapter > 0 ? narrator.seek(narrator.chapter - 1, 0) : narrator.seek(0, 0)));
      ms.setActionHandler('nexttrack', () => (narrator.chapter < b.script.length - 1 ? narrator.seek(narrator.chapter + 1, 0) : goNext.current(false)));
    } catch { /* unsupported action */ }
    return undefined;
  }, [book.data, st.chapterTitle, st.playing, narrator]);

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
  const current = st.text || viewScript[st.chapter]?.segments[st.segment]?.text || '';
  const voiceName = narrator.voice?.name || '';

  const me = slim(b);
  const canNext = queue.length > 0 || (repeat === 'all' && history.length > 0);
  const atEnd = st.chapter >= b.script.length - 1;
  const atStart = st.chapter === 0 && st.segment < 3;
  const prevTrack = () => {
    if (!atStart) { narrator.seek(narrator.segment > 2 ? narrator.chapter : narrator.chapter - 1, 0); return; }
    const id = queueActions.previous(b);
    if (id) onNavigate(id, { autoplay: true });
  };
  const nextTrack = () => (atEnd ? goNext.current(false) : narrator.seek(narrator.chapter + 1, 0));
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;

  return (
    <>
      {tr.running && <div className="translate-banner" role="status"><Loader2 size={14} className="spin" /> Translating the transcript &amp; narration… <span className="tb-bar"><i style={{ width: `${tr.progress}%` }} /></span> {tr.progress}%</div>}
      {!visible && (
        <div className="mini-now" role="region" aria-label="Now playing">
          <AlbumArt title={b.title} color={b.color} size="xs" playing={st.playing} bare />
          <div className="mn-info"><strong>{b.title}</strong><small>{st.chapterTitle} · {b.tone} narration</small></div>
          <button className="mn-play" onClick={() => narrator.toggle()} aria-label={st.playing ? 'Pause' : 'Play'}>{st.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
          <button onClick={nextTrack} aria-label="Next" disabled={atEnd && !canNext}><SkipForward size={17} /></button>
          <button onClick={onOpen} aria-label="Open player"><ChevronDown size={17} style={{ transform: 'rotate(180deg)' }} /></button>
          <div className="mn-bar"><i style={{ width: `${(elapsed / Math.max(1, total)) * 100}%` }} /></div>
        </div>
      )}
    <div className="audio-player" style={visible ? undefined : { display: 'none' }}>
      <div className="player-hero">
        <div className={`player-glow pal-${b.color}`}>
          <AlbumArt title={b.title} kicker={`${b.tone} narration`} color={b.color} size="lg" playing={st.playing} />
        </div>
        <div className="player-info">
          <div className="eyebrow">NOW PLAYING</div>
          <h3>{b.title}</h3>
          <p>{st.chapterTitle} · {b.tone} narration · {formatDuration(b.duration_seconds)}</p>
          <div className="player-right-actions">
            <button onClick={addBookmark} aria-label="Bookmark this moment" title="Bookmark this moment"><Bookmark size={17} /></button>
            <button onClick={() => api.audio.downloadScript(bookId).catch((e) => notify(e.message, 'error'))} aria-label="Download narration script" title="Download narration script"><Download size={17} /></button>
            <Menu label="Add to playlist" align="right" trigger={<span className="player-menu-btn"><ListPlus size={17} /></span>} items={[
              { label: 'Play next', onClick: () => queueActions.add(b, { next: true }) },
              { label: 'Add to queue', onClick: () => queueActions.add(b) },
              '-',
              ...lists.slice(0, 6).map((l) => ({ label: `Add to “${l.name}”${l.ids.includes(b.id) ? ' ✓' : ''}`, disabled: l.ids.includes(b.id), onClick: () => playlistActions.add(l.id, b.id) })),
              { label: 'New playlist…', onClick: () => onNewPlaylist(b.id) },
            ]} />
          </div>
        </div>
      </div>

      <div className="view-switch" role="tablist" aria-label="Player view">
        {[['listen', 'Listen', Headphones], ['transcript', 'Transcript', Quote], ['reader', 'Reader', BookOpen]].map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}><Icon size={14} /> {label}</button>
        ))}
      </div>
      {view !== 'listen' ? (
        <div className="player-lyrics">
          <div className="tx-head">
            <span className="eyebrow">{view === 'reader' ? 'READER' : 'TRANSCRIPT'}</span>
            <ReadLanguage languages={nv.languages} value={tlang} onChange={setTlang} status={tr} sourceLang={sourceLang} />
          </div>
          {view === 'reader'
            ? <ReaderView narrator={narrator} lang={viewLang} reducedMotion={prefs.accessibility.reducedMotion} />
            : <LyricsView narrator={narrator} lang={viewLang} reducedMotion={prefs.accessibility.reducedMotion} />}
        </div>
      ) : (
        <div className="now-reading" aria-live="off">
          {charIndex != null && current
            ? <>{current.slice(0, charIndex)}<mark>{current.slice(charIndex).split(/\s/)[0]}</mark>{current.slice(charIndex + (current.slice(charIndex).split(/\s/)[0] || '').length)}</>
            : current}
        </div>
      )}

      <PowerSeek value={elapsed} max={total} seed={b.title + b.tone} playing={st.playing} onSeek={(t) => narrator.seekTime(t)} />

      <div className="player-controls">
        <button className={shuffle ? 'ctl-on' : ''} onClick={queueActions.toggleShuffle} aria-pressed={shuffle} aria-label="Shuffle queue" title="Shuffle queue"><Shuffle size={17} /></button>
        <button onClick={() => narrator.skip(-10)} aria-label="Back 10 seconds" title="Back 10s (←)"><Rewind size={18} /><small>10</small></button>
        <button onClick={prevTrack} aria-label={atStart ? 'Previous album' : 'Previous chapter'} title={atStart ? 'Previous album' : 'Previous chapter'} disabled={atStart && history.length === 0}><SkipBack size={22} /></button>
        <button className="play-main" onClick={() => narrator.toggle()} aria-label={st.playing ? 'Pause' : 'Play'}>
          {st.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
        </button>
        <button onClick={nextTrack} aria-label={atEnd ? 'Next album in queue' : 'Next chapter'} title={atEnd ? 'Next album in queue (Shift+N)' : 'Next chapter'} disabled={atEnd && !canNext}><SkipForward size={22} /></button>
        <button onClick={() => narrator.skip(30)} aria-label="Forward 30 seconds" title="Forward 30s (→)"><FastForward size={18} /><small>30</small></button>
        <button className={repeat !== 'off' ? 'ctl-on' : ''} onClick={queueActions.cycleRepeat} aria-label={`Repeat: ${repeat}`} title={`Repeat: ${repeat}`}><RepeatIcon size={17} /></button>
      </div>

      <div className="player-footer">
        <Menu trigger={<span className="speed-btn">{rate}× <ChevronDown size={13} /></span>} label="Playback speed" align="up"
          items={SPEEDS.map((s) => ({ label: `${s}×`, checked: s === rate, onClick: () => changeRate(s) }))} />
        <ReadLanguage languages={nv.languages} value={tlang} onChange={setTlang} status={tr} sourceLang={sourceLang} align="up" />
        {voices.length > 0 && (
          <select className="voice-select" value={voiceName} onChange={(e) => changeVoice(e.target.value)} aria-label="Voice">
            {voices.filter((v) => /^en/i.test(v.lang) || v.name === voiceName).map((v) => <option key={v.name} value={v.name}>{v.name.replace(/Microsoft |Google /, '')}</option>)}
          </select>
        )}
        <Menu trigger={<span className={`sleep-btn ${sleep ? 'on' : ''}`}><Clock size={14} /> {sleep === -1 ? 'End of chapter' : sleepLeft != null ? formatClock(sleepLeft) : 'Sleep'}</span>} label="Sleep timer" align="up"
          items={SLEEP.map((m) => ({ label: m === 0 ? 'Off' : m === -1 ? 'End of chapter' : `${m} minutes`, checked: sleep === m, onClick: () => setSleep(m) }))} />
      </div>

      <div className="player-columns with-queue">
        <div className="player-chapters">
          <div className="eyebrow">CHAPTERS</div>
          <div className="chapter-list-scroll">
            {viewScript.map((ch, i) => (
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
        <QueuePanel current={me} playing={st.playing} library={library} compact onPlay={(id, o) => { queueActions.remove(id); onNavigate(id, { autoplay: true, chapter: o?.chapter ?? null }); }} />
      </div>
    </div>
    </>
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

export default function AudioStudioPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { notify, confirm, dataVersion } = useApp();
  const books = useQuery(() => api.audio.list(), [dataVersion]);
  const { queue } = useQueue();
  const tab = params.get('tab') || 'player';
  const [active, setActive] = useState(params.get('book'));
  const [run, setRun] = useState({ nonce: 0, autoplay: false, chapter: null });
  const [playing, setPlaying] = useState(false);
  const [newPl, setNewPl] = useState({ open: false, seed: null });
  const [openPl, setOpenPl] = useState(null);
  const list = books.data || [];
  const bookId = active || list.find((b) => b.status === 'ready')?.id;

  // deep links (?book=…) and cleanup of albums that were deleted
  const urlBook = params.get('book');
  useEffect(() => { if (urlBook) { setActive(urlBook); setRun((r) => ({ nonce: r.nonce + 1, autoplay: false, chapter: null })); } }, [urlBook]);
  useEffect(() => {
    if (!books.data) return;
    const ids = new Set(books.data.map((b) => b.id));
    queueActions.prune(ids);
    playlistActions.prune(ids);
  }, [books.data]);

  const setTab = (t) => setParams({ tab: t });
  const playAlbum = (id, { autoplay = true, chapter = null } = {}) => {
    if (!id) return;
    queueActions.remove(id);
    setActive(id);
    setRun((r) => ({ nonce: r.nonce + 1, autoplay, chapter }));
    setParams({ tab: 'player' });
  };
  const openNewPlaylist = (seed) => setNewPl({ open: true, seed });

  const removeAlbum = async (b) => {
    if (!(await confirm({ title: `Delete the ${b.tone} audiobook of “${b.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.audio.remove(b.id);
      books.setData((l) => l.filter((x) => x.id !== b.id));
      if (b.id === bookId) setActive(null);
    } catch (e) { notify(e.message, 'error'); }
  };
  const current = list.find((b) => b.id === bookId);

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
        { id: 'queue', label: 'Queue', icon: ListMusic, count: queue.length || undefined },
        { id: 'saved', label: 'Albums', count: list.length || undefined },
        { id: 'playlists', label: 'Playlists', icon: ListMusic },
        { id: 'generate', label: 'Generate', icon: Plus },
        { id: 'collab', label: 'Collaborative studio', icon: Users },
      ]} />

      {/* The player stays mounted on every tab so audio keeps playing while you browse. */}
      {bookId && <Player key={`${bookId}:${run.nonce}`} bookId={bookId} autoplay={run.autoplay} startChapter={run.chapter} visible={tab === 'player'} library={list}
        onNavigate={(id, o) => playAlbum(id, o)} onOpen={() => setTab('player')} onNewPlaylist={openNewPlaylist} onPlayingChange={setPlaying} />}
      {tab === 'player' && !bookId && (
        books.loading ? <Skeleton h={300} />
          : <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Choose humor, tough or regular narration — ReadVibe prepares it in the background." action="Generate audiobook" onAction={() => setTab('generate')} />
      )}
      {tab === 'queue' && (
        <div className="audio-player">
          <QueuePanel current={current && slim(current)} playing={playing} library={list} onPlay={(id, o) => playAlbum(id, { chapter: o?.chapter ?? null })} />
        </div>
      )}
      {tab === 'generate' && <Generate initialDoc={params.get('doc')} onReady={(id) => { books.reload(); playAlbum(id, { autoplay: false }); }} />}
      {tab === 'saved' && (books.error ? <ErrorState error={books.error} onRetry={books.reload} /> : !books.data ? <Skeleton h={200} />
        : <AlbumGrid books={list} playingId={bookId} playing={playing} onPlay={(id) => playAlbum(id)} onGenerate={() => setTab('generate')}
          onDelete={{ remove: removeAlbum, download: (b) => api.audio.downloadScript(b.id).catch((e) => notify(e.message, 'error')) }} onNewPlaylist={openNewPlaylist} />)}
      {tab === 'playlists' && <PlaylistsView books={list} playingId={bookId} playing={playing} onPlay={(id) => playAlbum(id)} onNewPlaylist={openNewPlaylist} openId={openPl} setOpenId={setOpenPl} />}
      {tab === 'collab' && <CollabStudio onOpenDoc={(id) => navigate(`/read/${id}`)} />}
      {tab === 'player' && <p className="fineprint"><Check size={11} /> Narration uses your device’s speech engine, so it works offline. Shortcuts: Space play/pause · ← back 10s · → forward 30s · Shift+N next album.</p>}

      <NewPlaylistModal open={newPl.open} seedBookId={newPl.seed} onClose={() => setNewPl({ open: false, seed: null })}
        onCreated={(id) => { setOpenPl(id); if (!newPl.seed) setTab('playlists'); else notify('Playlist created'); }} />
    </div>
  );
}
