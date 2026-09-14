// ─── Library Page ─────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import {
  Upload, Search, ChevronDown, MoreHorizontal, Cloud, Grid, List,
  Filter, Download, BookOpen, Headphones, FileText, Star, Check
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProgressBar, EmptyState } from '../components/ui';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'BOOK', label: 'Books' },
  { id: 'PAPER', label: 'Research Papers' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'offline', label: 'Downloads' },
  { id: 'favorites', label: 'Favorites' },
];

const SORT_OPTIONS = ['Recently opened', 'Title A–Z', 'Progress', 'Type'];

function DocumentCard({ doc, openDoc, viewMode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (viewMode === 'list') {
    return (
      <div className="doc-list-item">
        <button className="doc-list-cover" onClick={() => openDoc(doc)}>
          <div className={`mini-cover cover-${doc.color}`}><span>{doc.coverSymbol}</span></div>
        </button>
        <div className="doc-list-info" onClick={() => openDoc(doc)} role="button" tabIndex={0}>
          <div className="doc-type-row">
            <span className="doc-badge">{doc.format}</span>
            <span className="doc-tag-pill">{doc.tag}</span>
          </div>
          <h3>{doc.title}</h3>
          <p>{doc.author}</p>
        </div>
        <div className="doc-list-meta">
          <ProgressBar value={doc.progress} thin />
          <span className="doc-progress-label">{doc.progress}%</span>
          <small>{doc.lastOpened}</small>
        </div>
        <div className="doc-list-actions">
          {doc.offline && <span title="Available offline"><Download size={14} className="offline-icon" /></span>}
          {doc.audioGenerated && <span title="Audiobook ready"><Headphones size={14} className="audio-icon" /></span>}
          <button className="icon-button-sm" onClick={() => openDoc(doc)} aria-label="Open document">
            <BookOpen size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button className="doc-card" onClick={() => openDoc(doc)}>
      <div className={`mini-cover cover-${doc.color}`}>
        <span>{doc.coverSymbol}</span>
      </div>
      <div className="doc-info">
        <div className="doc-type-row">
          <span className="doc-badge">{doc.format}</span>
          <span className="doc-tag-pill">{doc.tag}</span>
        </div>
        <h3>{doc.title}</h3>
        <p>{doc.author}</p>
        <ProgressBar value={doc.progress} thin className="doc-progress" />
        <div className="doc-foot">
          <small>{doc.progress}% · {doc.lastOpened}</small>
          <div className="doc-icons">
            {doc.offline && <Download size={12} className="offline-icon" title="Offline" />}
            {doc.audioGenerated && <Headphones size={12} className="audio-icon" title="Audio ready" />}
          </div>
        </div>
      </div>
      <button
        className="doc-more"
        onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
        aria-label="More options"
        aria-haspopup="true"
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && (
        <div className="doc-menu" role="menu">
          {['Open', 'Generate audio', 'Download', 'Add to favorites', 'Remove'].map(item => (
            <button key={item} role="menuitem" onClick={e => e.stopPropagation()}>{item}</button>
          ))}
        </div>
      )}
    </button>
  );
}

export default function LibraryPage() {
  const { state, openDoc, dispatch, notify } = useApp();
  const { documents, libraryTab, librarySearch } = state;
  const [sort, setSort] = useState('Recently opened');
  const [viewMode, setViewMode] = useState('grid');
  const [sortOpen, setSortOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = [...documents];
    if (libraryTab === 'offline') list = list.filter(d => d.offline);
    else if (libraryTab === 'audiobooks') list = state.audiobooks || [];
    else if (libraryTab !== 'all') list = list.filter(d => d.type === libraryTab);
    if (librarySearch) {
      const q = librarySearch.toLowerCase();
      list = list.filter(d => d.title.toLowerCase().includes(q) || d.author.toLowerCase().includes(q));
    }
    if (sort === 'Title A–Z') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'Progress') list.sort((a, b) => b.progress - a.progress);
    return list;
  }, [documents, libraryTab, librarySearch, sort, state.audiobooks]);

  return (
    <div className="page-shell library-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>Library</h1>
        </div>
        <div className="top-actions">
          <button className="secondary-button" onClick={() => notify('Filter panel coming soon')}>
            <Filter size={15} /> Filter
          </button>
          <button className="primary-button" onClick={() => dispatch({ type: 'SET_UPLOAD_OPEN', payload: true })}>
            <Upload size={15} /> Upload
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="library-tabs" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={libraryTab === tab.id}
            className={libraryTab === tab.id ? 'selected' : ''}
            onClick={() => dispatch({ type: 'SET_LIBRARY_TAB', payload: tab.id })}
          >
            {tab.label}
            {tab.id === 'all' && <span>{documents.length}</span>}
            {tab.id === 'offline' && <span>{documents.filter(d => d.offline).length}</span>}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            value={librarySearch}
            onChange={e => dispatch({ type: 'SET_LIBRARY_SEARCH', payload: e.target.value })}
            placeholder="Search your library"
            aria-label="Search library"
          />
        </div>
        <div className="toolbar-right">
          <div className="sort-dropdown">
            <button className="sort-button" onClick={() => setSortOpen(!sortOpen)}>
              {sort} <ChevronDown size={14} />
            </button>
            {sortOpen && (
              <div className="dropdown-menu">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setSort(opt); setSortOpen(false); }}
                    className={sort === opt ? 'active' : ''}
                  >
                    {sort === opt && <Check size={13} />} {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
          ><Grid size={16} /></button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            aria-label="List view"
          ><List size={16} /></button>
        </div>
      </div>

      {/* Grid / List */}
      {filtered.length === 0 ? (
        <EmptyState
          emoji="📚"
          title="Your next reading experience starts here."
          description="Upload a document to get started."
          action="Upload document"
          onAction={() => dispatch({ type: 'SET_UPLOAD_OPEN', payload: true })}
        />
      ) : (
        <div className={viewMode === 'grid' ? 'library-grid' : 'library-list'}>
          {filtered.map((doc, i) => (
            <DocumentCard
              key={`${doc.id}-${i}`}
              doc={doc}
              openDoc={openDoc}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}

      {/* Offline Banner */}
      <div className="offline-banner">
        <Cloud size={19} className="offline-cloud" />
        <div>
          <strong>Offline reading is on</strong>
          <p>{documents.filter(d => d.offline).length} documents are available without internet.</p>
        </div>
        <button className="text-button" onClick={() => notify('Offline manager opened')}>
          Manage downloads
        </button>
      </div>
    </div>
  );
}
