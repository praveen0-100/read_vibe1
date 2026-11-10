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
import { useVoices } from '../features/playback/Player';
import { playbackActions, setPlayerSlot, usePlayback } from '../features/playback/playbackStore';
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
  const pb = usePlayback();
  const tab = params.get('tab') || 'player';
  const [newPl, setNewPl] = useState({ open: false, seed: null });
  const [openPl, setOpenPl] = useState(null);
  const list = books.data || [];
  const bookId = pb.bookId || list.find((b) => b.status === 'ready')?.id;
  const playing = pb.playing;

  // The player itself lives in the app shell (PlaybackHost) so it keeps playing across pages; this page only supplies its slot.
  const slotRef = useCallback((el) => setPlayerSlot(el), []);
  // deep links (?book=…)
  const urlBook = params.get('book');
  useEffect(() => { if (urlBook) playbackActions.open(urlBook); }, [urlBook]);

  const setTab = (t) => setParams({ tab: t });
  const playAlbum = (id, { autoplay = true, chapter = null, key = null, single = false } = {}) => {
    if (!id) return;
    if (key) queueActions.remove(key); else queueActions.removeBook(id);
    playbackActions.play(id, { autoplay, chapter, single });
    setParams({ tab: 'player' });
  };
  const openNewPlaylist = (seed) => setNewPl({ open: true, seed });

  const removeAlbum = async (b) => {
    if (!(await confirm({ title: `Delete the ${b.tone} audiobook of “${b.title}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.audio.remove(b.id);
      books.setData((l) => l.filter((x) => x.id !== b.id));
      playbackActions.dropIf(b.id);
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

      {/* The full player UI is portalled in here by PlaybackHost (always mounted, so audio never stops when you browse). */}
      <div ref={slotRef} className="player-slot" />
      {tab === 'player' && !bookId && (
        books.loading ? <Skeleton h={300} />
          : <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Choose humor, tough or regular narration — ReadVibe prepares it in the background." action="Generate audiobook" onAction={() => setTab('generate')} />
      )}
      {tab === 'queue' && (
        <div className="audio-player">
          <QueuePanel current={current && slim(current)} playing={playing} library={list} onPlay={(id, o) => playAlbum(id, { chapter: o?.chapter ?? null, key: o?.key, single: !!o?.single })} />
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
