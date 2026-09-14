// ─── Search Overlay ────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import { Search, X, ArrowRight, BookOpen, FileText, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function SearchOverlay() {
  const { state, dispatch, openDoc } = useApp();
  const { searchOpen, documents, notes, researchProjects } = state;
  const [query, setQuery] = useState('');

  if (!searchOpen) return null;

  const close = () => {
    dispatch({ type: 'SET_SEARCH_OPEN', payload: false });
    setQuery('');
  };

  const results = useMemo(() => {
    if (!query.trim()) return { docs: [], notes: [], projects: [] };
    const q = query.toLowerCase();
    return {
      docs: documents.filter(d => d.title.toLowerCase().includes(q) || d.author.toLowerCase().includes(q)),
      notes: notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)),
      projects: researchProjects.filter(p => p.title.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q)),
    };
  }, [query, documents, notes, researchProjects]);

  const totalResults = results.docs.length + results.notes.length + results.projects.length;
  const hasResults = totalResults > 0;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && close()}>
      <div className="search-modal" role="dialog" aria-label="Search" aria-modal="true">
        <div className="search-modal-top">
          <Search size={19} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search books, notes, projects..."
            aria-label="Search ReadVibe"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
          <button onClick={close} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        {query && (
          <div className="search-results">
            {!hasResults && (
              <div className="no-results">
                <Search size={32} />
                <p>No results for "<strong>{query}</strong>"</p>
                <small>Try a different search term</small>
              </div>
            )}

            {results.docs.length > 0 && (
              <div className="result-group">
                <div className="result-group-label"><BookOpen size={13} /> Documents</div>
                {results.docs.map(doc => (
                  <button
                    key={doc.id}
                    className="search-result-item"
                    onClick={() => { openDoc(doc); close(); }}
                  >
                    <div className={`mini-cover-xs cover-${doc.color}`}>{doc.coverSymbol}</div>
                    <div className="result-info">
                      <strong>{doc.title}</strong>
                      <small>{doc.author} · {doc.type} · {doc.progress}% read</small>
                    </div>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            )}

            {results.notes.length > 0 && (
              <div className="result-group">
                <div className="result-group-label"><FileText size={13} /> Notes</div>
                {results.notes.map(note => (
                  <button
                    key={note.id}
                    className="search-result-item"
                    onClick={() => { dispatch({ type: 'SET_PAGE', payload: 'notes' }); close(); }}
                  >
                    <div className="result-note-dot" />
                    <div className="result-info">
                      <strong>{note.title}</strong>
                      <small>{note.docTitle} · {note.category}</small>
                    </div>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            )}

            {results.projects.length > 0 && (
              <div className="result-group">
                <div className="result-group-label"><Sparkles size={13} /> Research</div>
                {results.projects.map(proj => (
                  <button
                    key={proj.id}
                    className="search-result-item"
                    onClick={() => { dispatch({ type: 'SET_PAGE', payload: 'research' }); close(); }}
                  >
                    <div className="result-project-dot" />
                    <div className="result-info">
                      <strong>{proj.title}</strong>
                      <small>{proj.sources} sources · {proj.status}</small>
                    </div>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="search-footer">
          <span className="shortcut-key">⌘ K</span>
          <span>Search across your entire reading world</span>
          {query && hasResults && <span className="result-count">{totalResults} result{totalResults !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  );
}
