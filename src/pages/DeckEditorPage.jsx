// ─── Presentation editor: slide rail · animated stage · inspector, with autosave and .pptx export ────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Check, Copy, Download, Loader2, Mic2, Play, Plus, RotateCcw, Shuffle, Trash2, Undo2 } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { useReducedMotion } from '../hooks/useDeckPlayer';
import { ANIMATIONS, ART_STYLES, DECK_THEMES, LAYOUT_LABEL, newSlide, THEME_KEYS, TRANSITIONS } from '../lib/deckThemes';
import { ErrorState, PageLoader } from '../components/ui';
import SlideView, { ScaledFrame } from '../components/deck/SlideStage';

const TEXT_LAYOUTS = ['concept', 'bullets', 'agenda', 'summary'];
const IMAGE_LAYOUTS = ['title', 'concept', 'bullets', 'summary', 'quote'];
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const pairLines = (s, sep = '|') => lines(s).map((l) => { const [a, ...b] = l.split(sep); return [a.trim(), b.join(sep).trim()]; });

/** Friendly editors for the slides that carry structured data; the rest fall back to JSON. */
function DataEditor({ slide, onChange }) {
  const d = slide.data || {};
  const L = slide.layout;
  const [json, setJson] = useState(() => JSON.stringify(d, null, 2));
  const [bad, setBad] = useState('');
  useEffect(() => { setJson(JSON.stringify(slide.data || {}, null, 2)); setBad(''); }, [slide.id, L]); // eslint-disable-line react-hooks/exhaustive-deps

  if (L === 'chart') {
    const rows = d.labels.map((l, i) => `${l} | ${d.values[i]}`).join('\n');
    return (
      <>
        <label className="ins-field">Chart type
          <select value={d.kind} onChange={(e) => onChange({ ...d, kind: e.target.value })}>{[['bar', 'Bars'], ['line', 'Line'], ['donut', 'Donut']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="ins-field">Data <small>one “label | value” per line</small>
          <textarea rows={6} defaultValue={rows} key={slide.id + L} onBlur={(e) => {
            const p = pairLines(e.target.value).filter(([a, b]) => a && Number.isFinite(parseFloat(b)));
            if (p.length >= 2) onChange({ ...d, labels: p.map(([a]) => a), values: p.map(([, b]) => parseFloat(b)) });
          }} />
        </label>
        <label className="ins-field">Unit <input value={d.unit || ''} maxLength={16} onChange={(e) => onChange({ ...d, unit: e.target.value })} /></label>
        <label className="ins-field">Caption <input value={d.caption || ''} maxLength={120} onChange={(e) => onChange({ ...d, caption: e.target.value })} /></label>
      </>
    );
  }
  if (L === 'process') {
    return (
      <>
        <label className="ins-field">Steps <small>one per line · “step | detail”</small>
          <textarea rows={6} key={slide.id} defaultValue={d.nodes.map((n) => (n.detail ? `${n.label} | ${n.detail}` : n.label)).join('\n')}
            onBlur={(e) => { const p = pairLines(e.target.value).filter(([a]) => a).slice(0, 8); if (p.length >= 3) onChange({ ...d, nodes: p.map(([label, detail]) => ({ label, detail })) }); }} />
        </label>
        <label className="ins-check"><input type="checkbox" checked={!!d.loop} onChange={(e) => onChange({ ...d, loop: e.target.checked })} /> Loops back to step 1</label>
      </>
    );
  }
  if (L === 'stats') {
    return (
      <label className="ins-field">Figures <small>“value | what it measures”</small>
        <textarea rows={5} key={slide.id} defaultValue={d.items.map((i) => `${i.value} | ${i.label}`).join('\n')}
          onBlur={(e) => { const p = pairLines(e.target.value).filter(([a]) => a).slice(0, 4); if (p.length >= 2) onChange({ items: p.map(([value, label]) => ({ value, label })) }); }} />
      </label>
    );
  }
  if (L === 'timeline') {
    return (
      <label className="ins-field">Events <small>“when | what happened”</small>
        <textarea rows={6} key={slide.id} defaultValue={d.events.map((e) => `${e.label} | ${e.detail}`).join('\n')}
          onBlur={(e) => { const p = pairLines(e.target.value).filter(([a]) => a).slice(0, 7); if (p.length >= 3) onChange({ events: p.map(([label, detail]) => ({ label, detail })) }); }} />
      </label>
    );
  }
  if (L === 'quote') {
    return (
      <>
        <label className="ins-field">Quote <textarea rows={4} value={d.text || ''} maxLength={220} onChange={(e) => onChange({ ...d, text: e.target.value })} /></label>
        <label className="ins-field">Source <input value={d.source || ''} maxLength={80} onChange={(e) => onChange({ ...d, source: e.target.value })} /></label>
      </>
    );
  }
  if (['hierarchy', 'mindmap', 'types', 'compare'].includes(L)) {
    return (
      <label className="ins-field">Structure <small>JSON — advanced</small>
        <textarea rows={10} className="mono" value={json} spellCheck={false} onChange={(e) => {
          setJson(e.target.value);
          try { onChange(JSON.parse(e.target.value)); setBad(''); } catch { setBad('Not valid JSON yet — changes apply when it is.'); }
        }} />
        {bad && <small className="field-error">{bad}</small>}
      </label>
    );
  }
  return null;
}

function Inspector({ slide, onEdit, onDuplicate, onDelete, onMove, index, total }) {
  const set = (patch) => onEdit({ ...slide, ...patch });
  const hasImage = IMAGE_LAYOUTS.includes(slide.layout);
  const text = TEXT_LAYOUTS.includes(slide.layout);
  return (
    <aside className="deck-inspector" aria-label="Slide settings">
      <div className="ins-head">
        <span className="eyebrow">{LAYOUT_LABEL[slide.layout] || 'Slide'} · {index + 1} of {total}</span>
        <span className="ins-actions">
          <button className="icon-ghost sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move slide up"><ArrowUp size={14} /></button>
          <button className="icon-ghost sm" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move slide down"><ArrowDown size={14} /></button>
          <button className="icon-ghost sm" onClick={onDuplicate} aria-label="Duplicate slide"><Copy size={14} /></button>
          <button className="icon-ghost sm danger" onClick={onDelete} disabled={total <= 1} aria-label="Delete slide"><Trash2 size={14} /></button>
        </span>
      </div>

      <label className="ins-field">Title <input value={slide.title} maxLength={90} onChange={(e) => set({ title: e.target.value })} /></label>
      {slide.layout === 'title' && <label className="ins-field">Subtitle <input value={slide.subtitle || ''} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} /></label>}
      {text && (
        <>
          <label className="ins-field">Layout
            <select value={slide.layout} onChange={(e) => set({ layout: e.target.value })}>{TEXT_LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}</select>
          </label>
          <label className="ins-field">Points <small>one per line</small>
            <textarea rows={6} defaultValue={slide.bullets.join('\n')} key={slide.id} onChange={(e) => set({ bullets: lines(e.target.value).slice(0, 7) })} />
          </label>
        </>
      )}
      <DataEditor slide={slide} onChange={(data) => set({ data })} />

      <div className="ins-row">
        <label className="ins-field">Entrance
          <select value={slide.anim} onChange={(e) => set({ anim: e.target.value })}>{ANIMATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="ins-field">Transition
          <select value={slide.transition} onChange={(e) => set({ transition: e.target.value })}>{TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>

      {hasImage && (
        <div className="ins-block">
          <span className="eyebrow">GENERATED PICTURE</span>
          {slide.image ? (
            <>
              <label className="ins-field">Scene <input value={slide.image.seed} maxLength={120} onChange={(e) => set({ image: { ...slide.image, seed: e.target.value } })} /></label>
              <div className="ins-row">
                <label className="ins-field">Style
                  <select value={slide.image.style || ''} onChange={(e) => set({ image: { ...slide.image, style: e.target.value } })}>
                    <option value="">Auto</option>{ART_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button className="secondary-button small" onClick={() => set({ image: { ...slide.image, seed: `${slide.image.seed.replace(/ #\d+$/, '')} #${Math.floor(Math.random() * 999)}` } })}><Shuffle size={13} /> New picture</button>
              </div>
              {slide.layout !== 'title' && slide.layout !== 'quote' && <button className="text-button" onClick={() => { const { image, ...rest } = slide; onEdit(rest); }}>Remove picture</button>}
            </>
          ) : <button className="secondary-button small" onClick={() => set({ image: { seed: slide.title, style: '' } })}><Plus size={13} /> Add a picture</button>}
        </div>
      )}

      <label className="ins-field"><span><Mic2 size={12} /> Speaker notes</span>
        <textarea rows={6} value={slide.notes || ''} maxLength={1400} onChange={(e) => set({ notes: e.target.value })} placeholder="What you'll say on this slide…" />
      </label>
      <label className="ins-field">Description for screen readers <input value={slide.alt || ''} maxLength={400} onChange={(e) => set({ alt: e.target.value })} /></label>
    </aside>
  );
}

export default function DeckEditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { notify, confirm } = useApp();
  const reduced = useReducedMotion();
  const deck = useQuery(() => api.decks.get(deckId), [deckId]);
  const [slides, setSlides] = useState(null);
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('aurora');
  const [sel, setSel] = useState(0);
  const [replay, setReplay] = useState(0);
  const [save, setSave] = useState('saved'); // saved | dirty | saving | error
  const [dragFrom, setDragFrom] = useState(null);
  const dirty = useRef(false);
  const history = useRef([]);
  const lastPush = useRef(0);

  // still being designed: wait for it
  useEffect(() => {
    if (!deck.data || deck.data.status === 'ready' || deck.data.status === 'failed') return undefined;
    const t = setInterval(deck.reload, 1500);
    return () => clearInterval(t);
  }, [deck.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (deck.data?.status === 'ready' && !slides) { setSlides(deck.data.slides); setTitle(deck.data.title); setTheme(deck.data.theme); }
  }, [deck.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // autosave: a short pause after the last edit
  useEffect(() => {
    if (!dirty.current || !slides) return undefined;
    setSave('dirty');
    const t = setTimeout(async () => {
      setSave('saving');
      const payload = slides.map((s) => ({ ...s, title: s.title.trim() || 'Untitled', bullets: TEXT_LAYOUTS.includes(s.layout) && !s.bullets.length ? ['Add a point'] : s.bullets }));
      try {
        const out = await api.decks.update(deckId, { title: title.trim() || 'Untitled presentation', theme, slides: payload });
        dirty.current = false;
        setSave('saved');
        const same = out.slides.length === payload.length && out.slides.every((s, i) => s.layout === payload[i].layout);
        if (!same) { setSlides(out.slides); notify('A slide was missing content, so it was simplified.', 'info'); }
      } catch (e) { setSave('error'); notify(e.message, 'error'); }
    }, 900);
    return () => clearTimeout(t);
  }, [slides, title, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving with unsaved edits asks first
  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const edit = useCallback((fn) => {
    setSlides((cur) => {
      const now = Date.now();
      if (now - lastPush.current > 1200) { history.current = [...history.current.slice(-30), cur]; lastPush.current = now; }
      dirty.current = true;
      return fn(cur);
    });
  }, []);
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    dirty.current = true;
    setSlides(prev);
    setSel((s) => Math.min(s, prev.length - 1));
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slide = slides?.[sel];
  const update = (next) => edit((cur) => cur.map((s, i) => (i === sel ? next : s)));
  const move = (from, to) => {
    if (to < 0 || to >= slides.length || from === to) return;
    edit((cur) => { const a = [...cur]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; });
    setSel(to);
  };
  const duplicate = () => { edit((cur) => { const a = [...cur]; a.splice(sel + 1, 0, { ...cur[sel], id: newSlide().id }); return a; }); setSel(sel + 1); };
  const remove = async () => {
    if (slides.length <= 1) return;
    if (!(await confirm({ title: 'Delete this slide?', message: 'You can bring it back with Undo (Ctrl+Z).', confirmLabel: 'Delete', danger: true }))) return;
    edit((cur) => cur.filter((_, i) => i !== sel));
    setSel((s) => Math.max(0, Math.min(s, slides.length - 2)));
  };
  const add = () => { edit((cur) => { const a = [...cur]; a.splice(sel + 1, 0, newSlide()); return a; }); setSel(sel + 1); setReplay((r) => r + 1); };
  const exportPptx = async () => {
    if (dirty.current) notify('Saving your edits first…', 'info');
    try { await api.decks.exportPptx(deckId); notify('Downloaded the .pptx'); } catch (e) { notify(e.message, 'error'); }
  };
  const open = (mode) => window.open(`/present/${deckId}?mode=${mode}`, '_blank', 'noopener');

  if (deck.error) return <div className="page-shell"><ErrorState error={deck.error} onRetry={deck.reload} /></div>;
  if (!deck.data) return <PageLoader label="Opening presentation…" />;
  if (deck.data.status === 'failed') return <div className="page-shell"><ErrorState error={{ message: deck.data.meta?.error || 'This presentation could not be generated.' }} onRetry={() => navigate('/decks')} /></div>;
  if (!slides) return <PageLoader label="Designing your slides…" />;

  const engine = deck.data.meta?.engine;
  return (
    <div className="page-shell deck-editor-page">
      <header className="deck-toolbar">
        <Link to="/decks" className="icon-ghost" aria-label="Back to presentations"><ArrowLeft size={18} /></Link>
        <input className="deck-title-input" value={title} maxLength={120} aria-label="Presentation title" onChange={(e) => { setTitle(e.target.value); dirty.current = true; }} />
        <span className={`save-state ${save}`} role="status">{save === 'saving' ? <><Loader2 size={12} className="spin" /> Saving…</> : save === 'dirty' ? 'Unsaved' : save === 'error' ? 'Save failed' : <><Check size={12} /> Saved</>}</span>
        <div className="dc-themes small" role="radiogroup" aria-label="Theme">
          {THEME_KEYS.map((k) => (
            <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''} title={DECK_THEMES[k].name} onClick={() => { setTheme(k); dirty.current = true; }}
              style={{ background: `linear-gradient(135deg, ${DECK_THEMES[k].bg0}, ${DECK_THEMES[k].bg1})`, '--sw1': DECK_THEMES[k].a1, '--sw2': DECK_THEMES[k].a2 }}><i /><i /></button>
          ))}
        </div>
        <button className="icon-ghost" onClick={undo} disabled={!history.current.length} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="secondary-button small" onClick={exportPptx}><Download size={14} /> .pptx</button>
        <button className="secondary-button small" onClick={() => open('presenter')}><Mic2 size={14} /> Presenter view</button>
        <button className="primary-button small" onClick={() => open('show')}><Play size={14} fill="currentColor" /> Slideshow</button>
      </header>
      {engine === 'local' && <p className="deck-note">Built with ReadVibe’s on-device engine. Connect an AI provider and regenerate for richer, more narrative slides — everything here stays editable either way.</p>}

      <div className="deck-editor">
        <nav className="deck-rail" aria-label="Slides">
          {slides.map((s, i) => (
            <button key={s.id} className={`deck-thumb ${i === sel ? 'on' : ''} ${dragFrom === i ? 'dragging' : ''}`} onClick={() => { setSel(i); setReplay((r) => r + 1); }}
              draggable onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragFrom != null) move(dragFrom, i); setDragFrom(null); }} aria-label={`Slide ${i + 1}: ${s.title}`} aria-current={i === sel}>
              <span className="thumb-n">{i + 1}</span>
              <ScaledFrame><SlideView slide={s} theme={theme} animate={false} /></ScaledFrame>
            </button>
          ))}
          <button className="deck-thumb add" onClick={add}><Plus size={16} /> Add slide</button>
        </nav>

        <main className="deck-stage-col">
          <div className="deck-stage">
            <ScaledFrame>
              <SlideView key={`${slide.id}:${replay}`} slide={slide} theme={theme} animate={!reduced} index={sel} total={slides.length} deckTitle={title} />
            </ScaledFrame>
          </div>
          <div className="deck-stage-actions">
            <button className="text-button" onClick={() => setReplay((r) => r + 1)}><RotateCcw size={13} /> Replay animation</button>
            <button className="text-button" onClick={() => setSel((s) => Math.max(0, s - 1))} disabled={sel === 0}>Previous</button>
            <button className="text-button" onClick={() => setSel((s) => Math.min(slides.length - 1, s + 1))} disabled={sel === slides.length - 1}>Next</button>
          </div>
          {slide.notes && <div className="deck-notes-peek"><span className="eyebrow">SPEAKER NOTES</span><p>{slide.notes}</p></div>}
        </main>

        <Inspector slide={slide} index={sel} total={slides.length} onEdit={update} onDuplicate={duplicate} onDelete={remove} onMove={(d) => move(sel, sel + d)} />
      </div>
    </div>
  );
}
