// Reader tools: typography settings, selection toolbar, highlight popover, in-document search.
import React, { useEffect, useRef, useState } from 'react';
import {
  AlignJustify, AlignLeft, BookA, ChevronDown, ChevronUp, Copy, Highlighter, Languages, Lightbulb, Loader2,
  MessageSquare, Search, StickyNote, Trash2, Volume2, Workflow, X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useDebounce } from '../../hooks/useAsync';
import { READING_FONTS } from '../../lib/prefs';
import { Segmented, Slider, Switch } from '../ui';

export const HIGHLIGHT_CATEGORIES = [
  { id: 'Important', color: 'coral' },
  { id: 'Definition', color: 'yellow' },
  { id: 'Question', color: 'blue' },
  { id: 'Exam', color: 'purple' },
  { id: 'Research', color: 'green' },
];
export const categoryColor = (c) => HIGHLIGHT_CATEGORIES.find((x) => x.id === c)?.color || 'yellow';

// ─── Typography & display settings ────────────────────────────────────────────
export function ReaderSettings({ onClose }) {
  const { prefs, setPrefs } = useApp();
  const r = prefs.reading;
  const set = (patch) => setPrefs({ reading: patch });
  return (
    <div className="popover reader-settings" role="dialog" aria-label="Reading settings">
      <div className="popover-head"><strong>Display</strong><button className="icon-ghost sm" onClick={onClose} aria-label="Close"><X size={14} /></button></div>
      <div className="eyebrow">PAGE</div>
      <div className="paper-options" role="radiogroup" aria-label="Page colour">
        {[['paper', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night'], ['contrast', 'High contrast']].map(([id, label]) => (
          <button key={id} role="radio" aria-checked={r.paper === id} className={`paper-swatch swatch-${id} ${r.paper === id ? 'chosen' : ''}`} onClick={() => set({ paper: id })}>Aa<small>{label}</small></button>
        ))}
      </div>
      <div className="eyebrow">TYPEFACE</div>
      <div className="font-options">
        {Object.entries(READING_FONTS).map(([id, f]) => (
          <button key={id} className={`font-btn ${r.font === id ? 'chosen' : ''}`} style={{ fontFamily: f.css }} onClick={() => set({ font: id })} aria-pressed={r.font === id}>{f.label}</button>
        ))}
      </div>
      <Slider label="Size" value={r.fontSize} min={13} max={30} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
      <Slider label="Line height" value={r.lineHeight} min={1.3} max={2.4} step={0.05} onChange={(v) => set({ lineHeight: v })} format={(v) => v.toFixed(2)} />
      <Slider label="Paragraph gap" value={r.paragraphSpacing} min={0.4} max={2} step={0.1} onChange={(v) => set({ paragraphSpacing: v })} format={(v) => `${v.toFixed(1)}em`} />
      <div className="settings-row">
        <Segmented size="sm" value={r.width} onChange={(v) => set({ width: v })} label="Reading width" options={[{ value: 'narrow', label: 'Narrow' }, { value: 'comfortable', label: 'Medium' }, { value: 'wide', label: 'Wide' }]} />
        <Segmented size="sm" value={r.align} onChange={(v) => set({ align: v })} label="Alignment" options={[{ value: 'left', label: '', icon: AlignLeft, title: 'Left aligned' }, { value: 'justify', label: '', icon: AlignJustify, title: 'Justified' }]} />
      </div>
      <Switch label="Focus line" description="Dim everything except the paragraph you’re reading" checked={r.focusLine} onChange={(v) => set({ focusLine: v })} />
      <Switch label="Reading ruler" description="A guide band that follows your pointer" checked={r.ruler} onChange={(v) => set({ ruler: v })} />
    </div>
  );
}

// ─── Floating selection toolbar ───────────────────────────────────────────────
export function SelectionToolbar({ pos, onAction }) {
  const [catOpen, setCatOpen] = useState(false);
  useEffect(() => setCatOpen(false), [pos?.x, pos?.y]);
  if (!pos) return null;
  const tools = [
    { id: 'highlight', label: 'Highlight', icon: Highlighter },
    { id: 'note', label: 'Note', icon: StickyNote },
    { id: 'explain', label: 'Explain', icon: Lightbulb },
    { id: 'ask', label: 'Ask AI', icon: MessageSquare },
    { id: 'define', label: 'Define', icon: BookA },
    { id: 'diagram', label: 'Visualise', icon: Workflow },
    { id: 'listen', label: 'Listen', icon: Volume2 },
    { id: 'translate', label: 'Translate', icon: Languages },
    { id: 'copy', label: 'Copy', icon: Copy },
  ];
  return (
    <div className={`selection-toolbar ${pos.below ? 'below' : ''}`} style={{ top: pos.y, left: pos.x }} role="toolbar" aria-label="Selected text actions"
      onMouseDown={(e) => e.preventDefault()}>
      {catOpen ? (
        <div className="hl-cats">
          {HIGHLIGHT_CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => onAction('highlight', c.id)}><i className={`hl-dot hl-${c.color}`} /> {c.id}</button>
          ))}
        </div>
      ) : tools.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => (id === 'highlight' ? setCatOpen(true) : onAction(id))} title={label}>
          <Icon size={13} /> <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Popover for an existing highlight ────────────────────────────────────────
export function HighlightPopover({ highlight, pos, onClose, onUpdate, onDelete, onExplain }) {
  const [note, setNote] = useState(highlight.note || '');
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => ref.current && !ref.current.contains(e.target) && !e.target.closest('mark[data-hl]') && onClose();
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [onClose]);
  return (
    <div ref={ref} className="popover hl-popover" style={{ top: pos.y, left: pos.x }} role="dialog" aria-label="Highlight">
      <div className="hl-cats inline">
        {HIGHLIGHT_CATEGORIES.map((c) => (
          <button key={c.id} className={highlight.category === c.id ? 'active' : ''} onClick={() => onUpdate({ category: c.id })} title={c.id}>
            <i className={`hl-dot hl-${c.color}`} /> {c.id}
          </button>
        ))}
      </div>
      <textarea className="input" rows={2} placeholder="Add a note to this highlight…" value={note} onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (highlight.note || '') && onUpdate({ note })} />
      <div className="hl-actions">
        <button className="text-button" onClick={() => onExplain(highlight.text)}><Lightbulb size={12} /> Explain</button>
        <button className="text-button danger" onClick={onDelete}><Trash2 size={12} /> Remove</button>
      </div>
    </div>
  );
}

// ─── In-document search ───────────────────────────────────────────────────────
export function DocSearch({ documentId, initialQuery = '', onJump, onClose, onQuery }) {
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [i, setI] = useState(0);
  const dq = useDebounce(q.trim(), 300);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    onQuery(dq);
    if (dq.length < 2) { setRes(null); return; }
    setLoading(true);
    api.documents.search(documentId, dq).then((r) => { setRes(r); setI(0); if (r.matches[0]) onJump(r.matches[0], 0); }).catch(() => setRes({ total: 0, matches: [] })).finally(() => setLoading(false));
  }, [dq, documentId]); // eslint-disable-line
  const go = (next) => {
    if (!res?.matches.length) return;
    const n = (next + res.matches.length) % res.matches.length;
    setI(n);
    onJump(res.matches[n], n);
  };
  return (
    <div className="doc-search" role="search">
      <div className="doc-search-bar">
        <Search size={15} />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this document" aria-label="Search in document"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? i - 1 : i + 1); } if (e.key === 'Escape') onClose(); }} />
        {loading && <Loader2 size={14} className="spin" />}
        {res && <span className="match-count">{res.total ? `${i + 1} / ${res.total}` : 'No matches'}</span>}
        <button className="icon-ghost sm" onClick={() => go(i - 1)} disabled={!res?.total} aria-label="Previous match"><ChevronUp size={15} /></button>
        <button className="icon-ghost sm" onClick={() => go(i + 1)} disabled={!res?.total} aria-label="Next match"><ChevronDown size={15} /></button>
        <button className="icon-ghost sm" onClick={onClose} aria-label="Close search"><X size={15} /></button>
      </div>
      {res?.matches?.length > 0 && (
        <ul className="doc-search-results">
          {res.matches.slice(0, 60).map((m, n) => (
            <li key={`${m.chapter_index}-${m.offset}`}>
              <button className={n === i ? 'active' : ''} onClick={() => { setI(n); onJump(m, n); }}>
                <small>{m.chapter_title}</small>
                <span>{m.before}<mark>{m.match}</mark>{m.after}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
