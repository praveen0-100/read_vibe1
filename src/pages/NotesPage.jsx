// ─── Study notebook ───────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Brain, ChevronLeft, ChevronRight, Download, Edit3, GraduationCap, Highlighter, Lightbulb, Pin, Plus,
  RotateCcw, Search, Sparkles, StickyNote, Trash2, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { timeAgo } from '../lib/format';
import { EmptyState, ErrorState, Field, Menu, Modal, RichText, Skeleton, Tabs } from '../components/ui';
import { categoryColor } from '../components/reader/ReaderTools';

const CATEGORIES = ['Note', 'Important', 'Question', 'Definition', 'Exam', 'Research', 'AI Insight'];
const TYPE_ICON = { highlight: Highlighter, summary: Sparkles, mindmap: Brain, diagram: Brain, quiz: GraduationCap, explanation: Lightbulb, ai_insight: Sparkles, flashcard: GraduationCap };

function NoteEditor({ note, docs, onClose, onSaved }) {
  const { notify } = useApp();
  const [f, setF] = useState(() => ({ title: note?.title || '', content: note?.content || '', category: note?.category || 'Note', document_id: note?.document_id || '' }));
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = note?.id
        ? await api.notes.update(note.id, { title: f.title, content: f.content, category: f.category })
        : await api.notes.create({ ...f, document_id: f.document_id || null });
      onSaved(saved);
      notify(note?.id ? 'Note updated' : 'Note added');
    } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} eyebrow={note?.id ? 'EDIT NOTE' : 'NEW NOTE'} title={note?.id ? 'Edit note' : 'New note'} icon={StickyNote}>
      <form className="stack" onSubmit={save}>
        {note?.quote && <blockquote className="note-quote">“{note.quote}”</blockquote>}
        <Field label="Title"><input className="input" required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} /></Field>
        <Field label="Note" hint="Supports **bold**, *italic* and - bullet lists"><textarea className="input" rows={7} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
        <div className="form-row">
          <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          {!note?.id && (
            <Field label="Document"><select className="input" value={f.document_id} onChange={(e) => setF({ ...f, document_id: e.target.value })}>
              <option value="">General note</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select></Field>
          )}
        </div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || !f.title.trim()}>Save</button></div>
      </form>
    </Modal>
  );
}

function StudyMode({ cards, onClose }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(new Set());
  const [deck, setDeck] = useState(cards);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === 'ArrowRight') { setI((x) => Math.min(deck.length - 1, x + 1)); setFlipped(false); }
      if (e.key === 'ArrowLeft') { setI((x) => Math.max(0, x - 1)); setFlipped(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deck.length]);
  const card = deck[i];
  const done = known.size === deck.length;
  return (
    <Modal open onClose={onClose} eyebrow="STUDY MODE" title={`Review · ${deck.length} cards`} icon={GraduationCap} size="md">
      {done ? (
        <div className="study-done">
          <h3>🎉 You know all {deck.length} cards!</h3>
          <button className="secondary-button" onClick={() => { setKnown(new Set()); setI(0); setDeck([...cards].sort(() => Math.random() - 0.5)); }}><RotateCcw size={14} /> Study again</button>
        </div>
      ) : (
        <div className="flashcards">
          <button className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
            <div className="fc-face fc-front"><small>{card.kind}</small><strong>{card.front}</strong><span>Space / tap to flip</span></div>
            <div className="fc-face fc-back"><small>{card.source}</small><p>{card.back}</p></div>
          </button>
          <div className="fc-controls">
            <button className="icon-ghost" onClick={() => { setI((x) => Math.max(0, x - 1)); setFlipped(false); }} disabled={i === 0} aria-label="Previous"><ChevronLeft size={18} /></button>
            <span>{i + 1} / {deck.length} · {known.size} known</span>
            <button className="icon-ghost" onClick={() => { setI((x) => Math.min(deck.length - 1, x + 1)); setFlipped(false); }} disabled={i === deck.length - 1} aria-label="Next"><ChevronRight size={18} /></button>
          </div>
          <div className="study-actions">
            <button className="secondary-button" onClick={() => { setFlipped(false); setI((x) => (x + 1) % deck.length); }}>Still learning</button>
            <button className="primary-button" onClick={() => {
              const nextKnown = new Set(known).add(card.id);
              setKnown(nextKnown);
              setFlipped(false);
              const order = [...deck.keys()];
              const after = [...order.slice(i + 1), ...order.slice(0, i)];
              const n = after.find((j) => !nextKnown.has(deck[j].id));
              if (n !== undefined) setI(n);
            }}>I know this</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function NotesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { notify, confirm, dataVersion } = useApp();
  const nb = useQuery(() => api.notes.notebook(), [dataVersion]);
  const docs = useQuery(() => api.documents.list({ sort: 'title' }), []);
  const [tab, setTab] = useState('all');
  const [category, setCategory] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [studying, setStudying] = useState(false);
  const docFilter = params.get('doc');
  const focusNote = params.get('note');

  useEffect(() => {
    if (focusNote && nb.data) {
      const n = nb.data.notes.find((x) => x.id === focusNote);
      if (n) setEditing(n);
    }
  }, [focusNote, nb.data]);

  const items = useMemo(() => {
    if (!nb.data) return [];
    const notes = nb.data.notes.map((n) => ({ ...n, kind: 'note' }));
    const hls = nb.data.highlights.map((h) => ({ ...h, kind: 'highlight', title: h.text, content: h.note || '', type: 'highlight', pinned: false }));
    let list = tab === 'highlights' ? hls : tab === 'notes' ? notes.filter((n) => n.type === 'note') : tab === 'ai' ? notes.filter((n) => n.type !== 'note' && n.type !== 'flashcard') : tab === 'flashcards' ? notes.filter((n) => n.type === 'flashcard') : [...notes, ...hls];
    if (docFilter) list = list.filter((x) => x.document_id === docFilter);
    if (category) list = list.filter((x) => x.category === category);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((x) => `${x.title} ${x.content || ''} ${x.quote || ''} ${x.document_title || ''}`.toLowerCase().includes(s));
    }
    return list.sort((a, b) => (b.pinned - a.pinned) || new Date(b.created_at) - new Date(a.created_at));
  }, [nb.data, tab, category, q, docFilter]);

  const cards = useMemo(() => {
    if (!nb.data) return [];
    const fromNotes = nb.data.notes.filter((n) => n.type === 'flashcard' || n.category === 'Definition').map((n) => ({ id: n.id, front: n.title, back: n.content || n.quote || '', kind: 'TERM', source: n.document_title || 'Your notes' }));
    const fromHl = nb.data.highlights.filter((h) => h.category === 'Exam' || h.category === 'Definition').map((h) => ({ id: h.id, front: h.category === 'Exam' ? `Recall this ${h.document_title ? `from “${h.document_title}”` : ''}` : h.text.split(/\s+/).slice(0, 6).join(' ') + '…', back: h.text, kind: h.category.toUpperCase(), source: h.document_title }));
    return [...fromNotes, ...fromHl].filter((c) => c.back);
  }, [nb.data]);

  const upsert = (n) => nb.setData((d) => ({ ...d, notes: d.notes.some((x) => x.id === n.id) ? d.notes.map((x) => (x.id === n.id ? n : x)) : [n, ...d.notes] }));
  const removeItem = async (item) => {
    if (!(await confirm({ title: item.kind === 'highlight' ? 'Remove this highlight?' : `Delete “${item.title.slice(0, 60)}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      if (item.kind === 'highlight') {
        await api.documents.removeHighlight(item.id);
        nb.setData((d) => ({ ...d, highlights: d.highlights.filter((h) => h.id !== item.id) }));
      } else {
        await api.notes.remove(item.id);
        nb.setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== item.id) }));
      }
    } catch (err) { notify(err.message, 'error'); }
  };
  const togglePin = async (n) => {
    upsert({ ...n, pinned: !n.pinned });
    api.notes.update(n.id, { pinned: !n.pinned }).catch((e) => notify(e.message, 'error'));
  };
  const openSource = (x) => x.document_id && navigate(`/read/${x.document_id}?chapter=${x.chapter_index ?? 0}${x.kind === 'highlight' || x.quote ? `&q=${encodeURIComponent((x.quote || x.text || '').split(/\s+/).slice(0, 6).join(' '))}` : ''}`);
  const docTitle = docFilter && (docs.data || []).find((d) => d.id === docFilter)?.title;
  const total = nb.data ? nb.data.notes.length + nb.data.highlights.length : 0;

  return (
    <div className="page-shell notes-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">STUDY NOTEBOOK</div>
          <h1>Your highlights & ideas</h1>
        </div>
        <div className="top-actions">
          <button className="secondary-button" onClick={() => setStudying(true)} disabled={!cards.length} title={cards.length ? '' : 'Save definitions, flashcards or Exam highlights to study'}><GraduationCap size={15} /> Study ({cards.length})</button>
          <button className="secondary-button" onClick={() => api.notes.exportMarkdown().catch((e) => notify(e.message, 'error'))} disabled={!total}><Download size={15} /> Export</button>
          <button className="primary-button" onClick={() => setEditing({})}><Plus size={15} /> New note</button>
        </div>
      </header>

      <Tabs value={tab} onChange={setTab} className="library-tabs" tabs={[
        { id: 'all', label: 'Everything', count: total || undefined },
        { id: 'highlights', label: 'Highlights', count: nb.data?.highlights.length || undefined },
        { id: 'notes', label: 'Notes' },
        { id: 'ai', label: 'AI outputs' },
        { id: 'flashcards', label: 'Flashcards' },
      ]} />

      <div className="library-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notebook" aria-label="Search notebook" />
        </div>
        <div className="toolbar-right chip-row">
          {docTitle && <button className="chip active" onClick={() => setParams({})}><BookOpen size={12} /> {docTitle} <X size={11} /></button>}
          {CATEGORIES.map((c) => (
            <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(category === c ? null : c)} aria-pressed={category === c}>
              <i className={`hl-dot hl-${categoryColor(c)}`} /> {c}
            </button>
          ))}
        </div>
      </div>

      {nb.error && <ErrorState error={nb.error} onRetry={nb.reload} />}
      {nb.loading && !nb.data ? (
        <div className="notes-grid">{[1, 2, 3].map((i) => <Skeleton key={i} h={200} r={14} />)}</div>
      ) : items.length === 0 ? (
        total === 0
          ? <EmptyState icon={StickyNote} title="Your highlights and ideas will appear here." description="Select text while reading to highlight it, add notes, or save AI summaries and mind maps." action="Start reading" onAction={() => navigate('/read')} />
          : <EmptyState icon={Search} title="Nothing matches these filters." action="Clear filters" onAction={() => { setQ(''); setCategory(null); setTab('all'); setParams({}); }} />
      ) : (
        <div className="notes-grid">
          {items.map((x) => {
            const Icon = TYPE_ICON[x.type] || StickyNote;
            return (
              <article key={`${x.kind}-${x.id}`} className={`note-card note-${categoryColor(x.category)} ${x.pinned ? 'pinned' : ''}`}>
                <div className="note-top">
                  <span className="note-tag"><Icon size={12} /> {x.kind === 'highlight' ? 'HIGHLIGHT' : x.type === 'note' ? 'NOTE' : x.type.replace('_', ' ').toUpperCase()} · {x.category}</span>
                  <Menu trigger={<span className="icon-ghost sm">⋯</span>} items={[
                    x.document_id && { label: 'Open in reader', icon: BookOpen, onClick: () => openSource(x) },
                    x.kind === 'note' && { label: 'Edit', icon: Edit3, onClick: () => setEditing(x) },
                    x.kind === 'note' && { label: x.pinned ? 'Unpin' : 'Pin', icon: Pin, onClick: () => togglePin(x) },
                    { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeItem(x) },
                  ]} />
                </div>
                {x.kind === 'highlight' ? <blockquote className="note-highlight">“{x.text}”</blockquote> : <h3>{x.title}</h3>}
                {x.quote && x.kind === 'note' && <blockquote className="note-quote small">“{x.quote}”</blockquote>}
                {x.content && <RichText text={x.content.length > 600 ? `${x.content.slice(0, 600)}…` : x.content} className="note-body" />}
                <div className="note-footer">
                  {x.document_title ? <button className="text-button" onClick={() => openSource(x)}><BookOpen size={11} /> {x.document_title}{x.chapter_index != null ? ` · §${x.chapter_index + 1}` : ''}</button> : <span>General</span>}
                  <span>{x.pinned && <Pin size={11} />} {timeAgo(x.created_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && <NoteEditor note={editing.id ? editing : null} docs={(docs.data || []).filter((d) => d.status === 'ready')} onClose={() => { setEditing(null); if (focusNote) setParams({}); }} onSaved={(n) => { upsert(n); setEditing(null); }} />}
      {studying && <StudyMode cards={cards} onClose={() => setStudying(false)} />}
    </div>
  );
}
