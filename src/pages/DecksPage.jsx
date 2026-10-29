// ─── Presentation studio: create a deck from a file or a library document, and browse your decks ─────────
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Download, FileUp, FileText, GitBranch, Image as ImageIcon, Loader2, Mic2, Network, Play, Presentation, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { timeAgo } from '../lib/format';
import { artSrc, DECK_THEMES, THEME_KEYS } from '../lib/deckThemes';
import { EmptyState, Menu, ProgressBar, Segmented, Skeleton, Slider, Switch } from '../components/ui';

const ACCEPT = '.txt,.md,.markdown,.docx,.pdf,.xml,.html,.htm,.epub,.pptx,.odt,.rtf,.csv,.json,.yaml,.yml,.tex,.rst,.log';
const STYLES = [
  { value: 'executive', label: 'Executive', title: 'Sparse, decision-first slides' },
  { value: 'academic', label: 'Academic', title: 'Definitions and how ideas relate' },
  { value: 'creative', label: 'Creative', title: 'Story-driven and vivid' },
  { value: 'technical', label: 'Technical', title: 'Components, steps and trade-offs' },
];
const FEATURES = [
  [Network, 'Mind maps'], [BarChart3, 'Charts'], [GitBranch, 'Flowcharts & hierarchies'], [ImageIcon, 'Generated images'],
  [Mic2, 'Speaker notes & presenter view'], [Download, '.pptx export'],
];

function DeckCard({ deck, onOpen, onPresent, onExport, onDelete }) {
  const busy = deck.status === 'processing' || deck.status === 'queued';
  const failed = deck.status === 'failed';
  return (
    <article className={`deck-card ${busy ? 'busy' : ''}`}>
      <button className="deck-cover" onClick={() => !busy && !failed && onOpen()} disabled={busy || failed} aria-label={`Open ${deck.title}`}>
        {busy || failed ? (
          <span className="deck-cover-state">{busy ? <><Loader2 size={22} className="spin" /> Designing…</> : <><X size={20} /> Failed</>}</span>
        ) : <img src={artSrc({ seed: deck.cover, style: '' }, deck.theme, 480, 270)} alt="" loading="lazy" />}
        {!busy && !failed && <span className="deck-cover-title">{deck.title}</span>}
      </button>
      <div className="deck-meta">
        <div>
          <strong>{deck.title}</strong>
          <small>{failed ? (deck.meta?.error || 'Could not be generated') : `${deck.slide_count} slides · ${DECK_THEMES[deck.theme]?.name || 'Aurora'} · ${timeAgo(deck.updated_at)}`}</small>
        </div>
        <Menu label={`Options for ${deck.title}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>} items={[
          { label: 'Open editor', icon: Wand2, disabled: busy || failed, onClick: onOpen },
          { label: 'Start slideshow', icon: Play, disabled: busy || failed, onClick: onPresent },
          { label: 'Download .pptx', icon: Download, disabled: busy || failed, onClick: onExport },
          '-',
          { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
        ]} />
      </div>
    </article>
  );
}

export default function DecksPage() {
  const navigate = useNavigate();
  const { notify, confirm } = useApp();
  const decks = useQuery(() => api.decks.list(), []);
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  const ready = (docs.data || []).filter((d) => d.status === 'ready');

  const [qs] = useSearchParams();
  const fromDoc = qs.get('doc'); // deep link from the reader's Book hub
  const [source, setSource] = useState(fromDoc ? 'library' : 'upload'); // upload | library
  const [file, setFile] = useState(null);
  const [docId, setDocId] = useState(fromDoc || '');
  const [over, setOver] = useState(false);
  const [opts, setOpts] = useState({ slides: 12, style: 'executive', theme: 'aurora', images: true, visuals: true, notes: true, focus: '' });
  const [run, setRun] = useState(null); // {progress, stage, error}
  const poll = useRef(null);
  const fileInput = useRef(null);
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));

  useEffect(() => () => clearInterval(poll.current), []);
  // decks still being designed (from this tab or an earlier visit) refresh themselves until they finish
  const pending = (decks.data || []).some((d) => d.status === 'processing' || d.status === 'queued');
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(decks.reload, 2000);
    return () => clearInterval(t);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const canGo = !run?.progress && (source === 'upload' ? !!file : !!(docId || ready[0]?.id));

  const watch = (jobId, deckId) => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const j = await api.activity.job(jobId);
        setRun((r) => (r ? { ...r, progress: Math.max(r.progress, 15 + j.progress * 0.85), stage: j.stage } : r));
        if (j.status === 'completed') {
          clearInterval(poll.current);
          setRun(null);
          navigate(`/decks/${deckId}`);
        } else if (j.status === 'failed') {
          clearInterval(poll.current);
          setRun({ progress: 0, stage: '', error: j.error || 'Generation failed' });
          decks.reload();
        }
      } catch { clearInterval(poll.current); }
    }, 700);
  };

  const generate = async () => {
    setRun({ progress: 1, stage: source === 'upload' ? 'Uploading' : 'Starting' });
    try {
      const res = source === 'upload'
        ? await api.decks.upload(file, opts, (p) => setRun((r) => (r ? { ...r, progress: Math.max(1, p * 0.15) } : r)))
        : await api.decks.create({ document_id: docId || ready[0].id, ...opts });
      decks.reload();
      watch(res.job_id, res.deck.id);
    } catch (err) {
      setRun({ progress: 0, stage: '', error: err.message });
    }
  };

  const take = (f) => {
    if (!f) return;
    setFile(f);
    setRun(null);
  };

  const exportDeck = (d) => api.decks.exportPptx(d.id).then(() => notify('Downloaded the .pptx')).catch((e) => notify(e.message, 'error'));
  const removeDeck = async (d) => {
    if (!(await confirm({ title: `Delete “${d.title}”?`, message: 'The presentation is removed; your source document is untouched.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api.decks.remove(d.id); decks.setData((l) => l.filter((x) => x.id !== d.id)); } catch (e) { notify(e.message, 'error'); }
  };
  const present = (d) => window.open(`/present/${d.id}?mode=show`, '_blank', 'noopener');

  const working = !!run && !run.error;

  return (
    <div className="page-shell decks-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">PRESENTATION STUDIO</div>
          <h1>Turn any document into a presentation.</h1>
        </div>
      </header>

      <section className="deck-create" aria-label="Create a presentation">
        <div className="dc-main">
          <Segmented value={source} onChange={(v) => { setSource(v); setRun(null); }} label="Source" options={[
            { value: 'upload', label: 'Upload a file', icon: FileUp }, { value: 'library', label: 'From my library', icon: FileText }]} />

          {source === 'upload' ? (
            <div className={`dc-drop ${over ? 'over' : ''} ${file ? 'has' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}>
              <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => take(e.target.files?.[0])} />
              {file ? (
                <>
                  <FileText size={26} />
                  <strong>{file.name}</strong>
                  <small>{(file.size / 1024 / 1024).toFixed(file.size > 1e6 ? 1 : 2)} MB · ready to convert</small>
                  <button className="text-button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>Choose a different file</button>
                </>
              ) : (
                <>
                  <FileUp size={28} />
                  <strong>Drop a file here</strong>
                  <small>TXT · DOCX · PDF · XML · MD · HTML · EPUB · PPTX · ODT · RTF · CSV · JSON — up to 60 MB</small>
                  <button className="secondary-button" onClick={() => fileInput.current?.click()}>Browse files</button>
                </>
              )}
            </div>
          ) : (
            <div className="dc-library">
              {docs.loading && !docs.data ? <Skeleton h={120} /> : ready.length === 0
                ? <p className="muted small">Your library is empty — upload a file instead.</p>
                : ready.slice(0, 40).map((d) => (
                  <button key={d.id} className={`dc-doc ${(docId || ready[0].id) === d.id ? 'on' : ''}`} onClick={() => setDocId(d.id)} aria-pressed={(docId || ready[0].id) === d.id}>
                    <FileText size={16} /><span><strong>{d.title}</strong><small>{d.author} · {d.chapter_count} sections</small></span>
                  </button>
                ))}
            </div>
          )}

          <label className="dc-focus">Focus <small>(optional)</small>
            <input value={opts.focus} maxLength={300} onChange={(e) => set({ focus: e.target.value })} placeholder="e.g. explain the key concepts for first-year students" />
          </label>
        </div>

        <div className="dc-side">
          <div className="dc-field"><span className="eyebrow">STYLE</span><Segmented value={opts.style} onChange={(v) => set({ style: v })} options={STYLES} size="sm" label="Style" /></div>
          <div className="dc-field">
            <span className="eyebrow">THEME</span>
            <div className="dc-themes" role="radiogroup" aria-label="Theme">
              {THEME_KEYS.map((k) => {
                const t = DECK_THEMES[k];
                return (
                  <button key={k} role="radio" aria-checked={opts.theme === k} className={opts.theme === k ? 'on' : ''} onClick={() => set({ theme: k })} title={t.name}
                    style={{ background: `linear-gradient(135deg, ${t.bg0}, ${t.bg1})`, '--sw1': t.a1, '--sw2': t.a2 }}>
                    <i /><i /><span>{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Slider label="Slides" value={opts.slides} min={6} max={24} onChange={(v) => set({ slides: v })} />
          <Switch label="Mind maps, charts & flowcharts" checked={opts.visuals} onChange={(v) => set({ visuals: v })} />
          <Switch label="Generated images" checked={opts.images} onChange={(v) => set({ images: v })} />
          <Switch label="Speaker notes" checked={opts.notes} onChange={(v) => set({ notes: v })} />

          {run?.error && <p className="field-error" role="alert">{run.error}</p>}
          {working ? (
            <div className="dc-progress" role="status">
              <ProgressBar value={run.progress} />
              <small><Loader2 size={12} className="spin" /> {run.stage} · {Math.round(run.progress)}%</small>
            </div>
          ) : (
            <button className="primary-button full-width" disabled={!canGo} onClick={generate}><Sparkles size={16} /> Generate presentation</button>
          )}
        </div>

        <ul className="dc-features">{FEATURES.map(([Icon, label]) => <li key={label}><Icon size={14} /> {label}</li>)}</ul>
      </section>

      <section aria-label="Your presentations">
        <div className="section-head"><h2>Your presentations</h2></div>
        {decks.loading && !decks.data ? <Skeleton h={180} />
          : !decks.data?.length ? <EmptyState icon={Presentation} title="No presentations yet" description="Drop a file above and ReadVibe will design the slides, diagrams and speaker notes." />
            : (
              <div className="deck-grid">
                {decks.data.map((d) => (
                  <DeckCard key={d.id} deck={d} onOpen={() => navigate(`/decks/${d.id}`)} onPresent={() => present(d)} onExport={() => exportDeck(d)} onDelete={() => removeDeck(d)} />
                ))}
              </div>
            )}
      </section>
    </div>
  );
}
