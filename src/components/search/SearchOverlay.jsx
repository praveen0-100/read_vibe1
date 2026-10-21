// ─── Global search (Ctrl/⌘ K) ─────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Brain, FileText, Highlighter, Quote, Search, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useDebounce } from '../../hooks/useAsync';
import { Cover, Spinner } from '../ui';

const QUICK_LINKS = [
  { label: 'Open library', to: '/library', icon: BookOpen },
  { label: 'Audio Studio', to: '/audio', icon: FileText },
  { label: 'Start research', to: '/research', icon: Brain },
  { label: 'Study notebook', to: '/notes', icon: Highlighter },
];

function Highlight({ text, query }) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

export default function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(0);
  const debounced = useDebounce(query.trim(), 220);
  const listRef = useRef(null);

  useEffect(() => {
    if (!searchOpen) { setQuery(''); setResults(null); setCursor(0); }
  }, [searchOpen]);

  useEffect(() => {
    if (!debounced) { setResults(null); return undefined; }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api.activity.search(debounced, ctrl.signal)
      .then((r) => { setResults(r); setCursor(0); })
      .catch((e) => e.name !== 'AbortError' && setError(e))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced]);

  const items = useMemo(() => {
    if (!results) return QUICK_LINKS.map((l) => ({ group: 'Jump to', key: l.to, title: l.label, icon: l.icon, go: () => navigate(l.to) }));
    const list = [];
    results.documents.forEach((d) => list.push({ group: 'Documents', key: `d${d.id}`, title: d.title, sub: `${d.author} · ${d.type} · ${Math.round(d.progress)}% read`, doc: d, go: () => navigate(`/read/${d.id}`) }));
    results.passages.forEach((p, i) => list.push({ group: 'Inside your documents', key: `p${i}`, title: p.snippet, sub: `${p.document_title} · ${p.chapter_title}`, icon: Quote, go: () => navigate(`/read/${p.document_id}?chapter=${p.chapter_index}&q=${encodeURIComponent(debounced)}`) }));
    results.highlights.forEach((h) => list.push({ group: 'Highlights', key: `h${h.id}`, title: `“${h.text}”`, sub: h.category, icon: Highlighter, go: () => navigate(`/read/${h.document_id}?chapter=${h.chapter_index}`) }));
    results.notes.forEach((n) => list.push({ group: 'Notes', key: `n${n.id}`, title: n.title, sub: `${n.category} · ${n.snippet}`, icon: FileText, go: () => navigate(`/notes?note=${n.id}`) }));
    results.projects.forEach((p) => list.push({ group: 'Research', key: `r${p.id}`, title: p.title, sub: p.status, icon: Brain, go: () => navigate(`/research/${p.id}`) }));
    return list;
  }, [results, navigate, debounced]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!searchOpen) return null;
  const close = () => setSearchOpen(false);
  const choose = (item) => { item.go(); close(); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (e.key === 'Enter' && items[cursor]) { e.preventDefault(); choose(items[cursor]); }
    if (e.key === 'Escape') close();
  };

  let lastGroup = null;
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="search-modal" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-modal-top">
          <Search size={18} aria-hidden="true" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="Search titles, passages, highlights, notes, projects…" aria-label="Search ReadVibe"
            role="combobox" aria-expanded="true" aria-controls="search-results" aria-activedescendant={items[cursor]?.key} />
          {loading && <Spinner size={15} />}
          {query && <button className="icon-ghost" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
          <kbd className="esc-key" onClick={close}>Esc</kbd>
        </div>
        <div className="search-results" id="search-results" role="listbox" ref={listRef}>
          {error && <p className="search-empty">{error.message}</p>}
          {results && items.length === 0 && !loading && (
            <div className="search-empty"><Search size={28} /><p>No results for “<strong>{debounced}</strong>”</p><small>Try fewer or different words.</small></div>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="result-group-label" key={`g-${item.group}`}>{item.group}</div> : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <React.Fragment key={item.key}>
                {header}
                <button id={item.key} role="option" aria-selected={i === cursor} data-active={i === cursor} className="search-result-item"
                  onMouseEnter={() => setCursor(i)} onClick={() => choose(item)}>
                  {item.doc ? <Cover doc={item.doc} size="xs" /> : <span className="result-icon">{Icon && <Icon size={14} />}</span>}
                  <span className="result-info">
                    <strong><Highlight text={item.title} query={debounced} /></strong>
                    {item.sub && <small>{item.sub}</small>}
                  </span>
                  <ArrowRight size={14} className="result-arrow" />
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span>
          <span className="grow">Search across your entire reading world</span>
        </div>
      </div>
    </div>
  );
}
