// Reader tools: typography settings, selection toolbar, highlight popover, in-document search.
import React, { useEffect, useRef, useState } from 'react';
import {
  AlignJustify, AlignLeft, BookA, ChevronDown, ChevronUp, Copy, Flag, Highlighter, Languages, Lightbulb, Loader2, MoreHorizontal, Pin, PinOff,
  MessageSquare, Play, Search, Share2, StickyNote, Trash2, Volume2, Workflow, X,
} from 'lucide-react';
import { api } from '../../api/client';
import AnnotatePanel from './AnnotatePanel';
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
      <Slider label="Letter spacing" value={r.letterSpacing || 0} min={0} max={0.12} step={0.01} onChange={(v) => set({ letterSpacing: v })} format={(v) => `${v.toFixed(2)}em`} />
      <Slider label="Paragraph gap" value={r.paragraphSpacing} min={0.4} max={2} step={0.1} onChange={(v) => set({ paragraphSpacing: v })} format={(v) => `${v.toFixed(1)}em`} />
      <div className="settings-row">
        <Segmented size="sm" value={r.width} onChange={(v) => set({ width: v })} label="Reading width" options={[{ value: 'narrow', label: 'Narrow' }, { value: 'comfortable', label: 'Medium' }, { value: 'wide', label: 'Wide' }]} />
        <Segmented size="sm" value={r.align} onChange={(v) => set({ align: v })} label="Alignment" options={[{ value: 'left', label: '', icon: AlignLeft, title: 'Left aligned' }, { value: 'justify', label: '', icon: AlignJustify, title: 'Justified' }]} />
      </div>
      <Switch label="Focus line" description="Dim everything except the paragraph you’re reading" checked={r.focusLine} onChange={(v) => set({ focusLine: v })} />
      <Switch label="About this book" description="Show a short summary card the first time you open a book" checked={r.aboutBook !== false} onChange={(v) => set({ aboutBook: v })} />
      <Switch label="Reading ruler" description="A guide band that follows your pointer" checked={r.ruler} onChange={(v) => set({ ruler: v })} />
    </div>
  );
}

// ─── Floating selection toolbar ───────────────────────────────────────────────
export function SelectionToolbar({ pos, onAction }) {
  const [panel, setPanel] = useState(null); // null | 'annotate' | 'more'
  const [marks, setMarks] = useState({});
  useEffect(() => { setPanel(null); setMarks({}); }, [pos?.x, pos?.y]);
  if (!pos) return null;
  const main = [
    { id: 'annotate', label: 'Annotate', icon: Highlighter },
    { id: 'lookup', label: 'Look Up', icon: BookA },
    { id: 'note', label: 'Note', icon: StickyNote },
    { id: 'copy', label: 'Copy', icon: Copy },
    { id: 'pin', label: 'Pin', icon: Pin },
    { id: 'share', label: 'Share', icon: Share2 },
    { id: 'report', label: 'Report', icon: Flag },
  ];
  const more = [
    { id: 'explain', label: 'Explain', icon: Lightbulb },
    { id: 'ask', label: 'Ask AI', icon: MessageSquare },
    { id: 'define', label: 'AI define', icon: BookA },
    { id: 'diagram', label: 'Visualise', icon: Workflow },
    { id: 'listen', label: 'Listen', icon: Volume2 },
    { id: 'translate', label: 'Translate', icon: Languages },
    { id: 'search', label: 'Search', icon: Search },
  ];
  const apply = (next) => { setMarks(next); onAction('annotate', next); };
  return (
    <div className={`selection-toolbar ${pos.below ? 'below' : ''}`} style={{ top: pos.y, left: pos.x }} role="toolbar" aria-label="Selected text actions"
      onMouseDown={(e) => e.preventDefault()}>
      {panel === 'annotate' ? (
        <AnnotatePanel marks={marks} onChange={apply} onBack={() => setPanel(null)} />
      ) : (
        <>
          {(panel === 'more' ? more : main).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => (id === 'annotate' ? setPanel('annotate') : onAction(id))} title={label}>
              <Icon size={13} /> <span>{label}</span>
            </button>
          ))}
          <button onClick={() => setPanel(panel === 'more' ? null : 'more')} title={panel === 'more' ? 'Back' : 'More'} aria-label={panel === 'more' ? 'Back' : 'More actions'}>
            {panel === 'more' ? <X size={13} /> : <MoreHorizontal size={13} />}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Popover for an existing highlight ────────────────────────────────────────
export function HighlightPopover({ highlight, pos, onClose, onUpdate, onDelete, onExplain, onAction, startStyles = false }) {
  const [note, setNote] = useState(highlight.note || '');
  const [styles, setStyles] = useState(startStyles);
  const ref = useRef(null);
  useEffect(() => {
    const out = (e) => ref.current && !ref.current.contains(e.target) && !e.target.closest('mark[data-hl]') && onClose();
    document.addEventListener('pointerdown', out);
    return () => document.removeEventListener('pointerdown', out);
  }, [onClose]);
  return (
    <div ref={ref} className="popover hl-popover" style={{ top: pos.y, left: pos.x }} role="dialog" aria-label="Annotation">
      {styles ? (
        <AnnotatePanel compact marks={highlight.marks || {}} onBack={() => setStyles(false)} onChange={(marks) => onUpdate({ marks })} />
      ) : (
        <>
          <div className="hl-cats inline">
            {HIGHLIGHT_CATEGORIES.map((c) => (
              <button key={c.id} className={highlight.category === c.id ? 'active' : ''} onClick={() => onUpdate({ category: c.id })} title={c.id}>
                <i className={`hl-dot hl-${c.color}`} /> {c.id}
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} placeholder="Add a note to this highlight…" value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (highlight.note || '') && onUpdate({ note })} />
          <div className="hl-actions wrap">
            <button className="text-button danger" onClick={onDelete}><Trash2 size={12} /> Delete</button>
            <button className="text-button" onClick={() => setStyles(true)}><Highlighter size={12} /> Annotate</button>
            <button className="text-button" onClick={() => onAction('lookup', highlight.text)}><BookA size={12} /> Look Up</button>
            <button className="text-button" onClick={() => onAction('copy', highlight.text)}><Copy size={12} /> Copy</button>
            <button className="text-button" onClick={() => onUpdate({ pinned: !highlight.pinned })}>{highlight.pinned ? <PinOff size={12} /> : <Pin size={12} />} {highlight.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="text-button" onClick={() => onAction('share', highlight.text)}><Share2 size={12} /> Share</button>
            <button className="text-button" onClick={() => onAction('report', highlight.text)}><Flag size={12} /> Report</button>
            <button className="text-button" onClick={() => onExplain(highlight.text)}><Lightbulb size={12} /> Explain</button>
          </div>
        </>
      )}
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

// ─── Overlay for a tapped word: start reading aloud from it, or look it up ────
export function WordMenu({ menu, onAction }) {
  if (!menu) return null;
  return (
    <div className={`selection-toolbar word-menu ${menu.pos.below ? 'below' : ''}`} style={{ top: menu.pos.y, left: menu.pos.x }} role="toolbar"
      aria-label={`Actions for “${menu.word}”`} onMouseDown={(e) => e.preventDefault()}>
      <button className="primary" onClick={() => onAction('listen')} autoFocus><Play size={13} fill="currentColor" /> <span>Read aloud from here</span></button>
      <button onClick={() => onAction('define')} title="Define"><BookA size={13} /> <span>Define</span></button>
      <button onClick={() => onAction('explain')} title="Explain"><Lightbulb size={13} /> <span>Explain</span></button>
      <button onClick={() => onAction('ask')} title="Ask AI"><MessageSquare size={13} /> <span>Ask AI</span></button>
    </div>
  );
}
