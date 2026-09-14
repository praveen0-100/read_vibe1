// ─── Notes Page ───────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import { Plus, MoreHorizontal, Search, Filter, BookOpen, Sparkles, Tag, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { EmptyState, SectionHead } from '../components/ui';

const CATEGORY_COLORS = {
  Important: 'coral',
  Definition: 'amber',
  Question: 'blue',
  'AI Insight': 'purple',
  Exam: 'green',
  Research: 'lavender',
};

const NOTE_TABS = [
  { id: 'all', label: 'All notes' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'note', label: 'Notes' },
  { id: 'ai_insight', label: 'AI insights' },
];

function NoteCard({ note }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const color = CATEGORY_COLORS[note.category] || 'default';

  return (
    <div className={`note-card note-${color}`}>
      <div className="note-tag">
        {note.category.toUpperCase()} · {note.docTitle.toUpperCase().substring(0, 30)}
      </div>
      <h3>{note.title}</h3>
      <p>{note.content}</p>
      {note.aiExplanation && (
        <div className="note-ai-explanation">
          <Sparkles size={13} />
          <span>{note.aiExplanation}</span>
        </div>
      )}
      <div className="note-footer">
        <span>
          {note.page ? `p. ${note.page}` : note.createdAt}
          {note.chapter && ` · ${note.chapter}`}
        </span>
        <div className="note-footer-right">
          {note.docTitle && <span className="note-doc">{note.type === 'ai_insight' ? '🤖 AI' : '🔖'}</span>}
          <button
            className="icon-btn-xs"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="More options"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="note-menu">
          {['Copy text', 'Edit note', 'Export', 'Delete'].map(action => (
            <button key={action}>{action}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteList({ note }) {
  return (
    <div className="note-list-item">
      <div className={`note-list-dot dot-${CATEGORY_COLORS[note.category] || 'default'}`} />
      <div className="note-list-body">
        <div className="note-list-meta">{note.category} · {note.docTitle}</div>
        <p>{note.title}</p>
        <small>{note.page ? `p. ${note.page}` : note.createdAt}</small>
      </div>
    </div>
  );
}

export default function NotesPage() {
  const { state, notify } = useApp();
  const { notes } = state;
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [docFilter, setDocFilter] = useState('all');

  const uniqueDocs = [...new Set(notes.map(n => n.docTitle))];

  const filtered = useMemo(() => {
    let list = [...notes];
    if (tab !== 'all') list = list.filter(n => n.type === tab);
    if (docFilter !== 'all') list = list.filter(n => n.docTitle === docFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }
    return list;
  }, [notes, tab, search, docFilter]);

  return (
    <div className="page-shell notes-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">YOUR NOTEBOOK</div>
          <h1>Ideas worth keeping.</h1>
        </div>
        <div className="top-actions">
          <button className="primary-button" onClick={() => notify('Note editor opened')}>
            <Plus size={15} /> New note
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="notes-filter" role="tablist">
        {NOTE_TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            className={tab === t.id ? 'selected' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span>{tab === t.id ? filtered.length : notes.filter(n => t.id === 'all' ? true : n.type === t.id).length}</span>
          </button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="notes-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            aria-label="Search notes"
          />
        </div>
        <select
          value={docFilter}
          onChange={e => setDocFilter(e.target.value)}
          className="doc-filter-select"
          aria-label="Filter by document"
        >
          <option value="all">All documents</option>
          {uniqueDocs.map(doc => <option key={doc} value={doc}>{doc}</option>)}
        </select>
      </div>

      {/* Notes */}
      {filtered.length === 0 ? (
        <EmptyState
          emoji="🗒️"
          title="Your highlights and ideas will appear here."
          description="Highlight text in any document to start building your notebook."
        />
      ) : (
        <div className="notes-grid">
          {filtered.map(note => <NoteCard key={note.id} note={note} />)}
        </div>
      )}

      {/* Study Notebook Banner */}
      <div className="study-notebook-banner">
        <div className="snb-icon"><Sparkles size={18} /></div>
        <div>
          <strong>Study Notebook</strong>
          <p>All your highlights, AI insights, diagrams and mind maps in one connected view.</p>
        </div>
        <button className="secondary-button" onClick={() => notify('Study Notebook — coming in Phase 2')}>
          Open Notebook →
        </button>
      </div>
    </div>
  );
}
