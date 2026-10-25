// ─── Library ──────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpDown, BookOpen, Check, CloudDownload, CloudOff, Download, Edit3, Grid, Headphones,
  List, Loader2, MoreHorizontal, Pin, Play, Search, Star, Trash2, Upload, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useDebounce, useQuery } from '../hooks/useAsync';
import { formatDuration, formatMinutes, timeAgo } from '../lib/format';
import { offline } from '../lib/offline';
import { Cover, EmptyState, ErrorState, Field, Menu, Modal, ProgressBar, Segmented, Skeleton, Tabs } from '../components/ui';

const SORTS = [
  { id: 'recent', label: 'Recently opened' },
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'progress', label: 'Progress' },
  { id: 'type', label: 'Type' },
];
const COLORS = ['coral', 'blue', 'lavender', 'amber', 'green', 'rose'];

function EditModal({ doc, onClose, onSaved }) {
  const { notify } = useApp();
  const [form, setForm] = useState(() => ({ title: doc.title, author: doc.author, doc_type: doc.type, tags: (doc.tags || []).join(', '), color: doc.color, description: doc.description || '' }));
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.documents.update(doc.id, { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8) });
      notify('Details saved');
      onSaved(updated);
    } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} eyebrow="DOCUMENT DETAILS" title="Edit details" icon={Edit3}>
      <form className="stack" onSubmit={save}>
        <Field label="Title"><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Author"><input className="input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} /></Field>
        <Field label="Type">
          <Segmented size="sm" value={form.doc_type} onChange={(v) => setForm({ ...form, doc_type: v })} options={[{ value: 'BOOK', label: 'Book' }, { value: 'PAPER', label: 'Paper' }, { value: 'DOCUMENT', label: 'Document' }]} />
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. Design, Exam"><input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        <Field label="Cover colour">
          <div className="color-picker">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch cover-${c} ${form.color === c ? 'chosen' : ''}`} onClick={() => setForm({ ...form, color: c })} aria-label={c} aria-pressed={form.color === c}>
                {form.color === c && <Check size={13} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description"><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={saving}>{saving && <Loader2 size={14} className="spin" />} Save</button>
        </div>
      </form>
    </Modal>
  );
}

function DocCard({ doc, view, onChange, onRemove, onEdit, savedOffline }) {
  const { notify, confirm } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ready = doc.status === 'ready';
  const open = () => ready && navigate(`/read/${doc.id}`);

  const patch = async (data, msg) => {
    try {
      const updated = await api.documents.update(doc.id, data);
      onChange(updated);
      if (msg) notify(msg);
    } catch (err) { notify(err.message, 'error'); }
  };

  const toggleOffline = async () => {
    setBusy(true);
    try {
      if (savedOffline) {
        await offline.remove(doc.id);
        await patch({ offline: false }, 'Removed from offline downloads');
      } else {
        const pkg = await api.documents.package(doc.id);
        await offline.save(pkg);
        await patch({ offline: true }, `“${doc.title}” is available offline`);
      }
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete “${doc.title}”?`, message: 'Its highlights, bookmarks and audiobooks will be deleted too. Notes are kept.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.documents.remove(doc.id);
      await offline.remove(doc.id).catch(() => {});
      onRemove(doc.id);
      notify('Document deleted');
    } catch (err) { notify(err.message, 'error'); }
  };

  const menu = (
    <Menu trigger={<MoreHorizontal size={15} />} label={`Actions for ${doc.title}`} items={[
      ready && { label: 'Open', icon: BookOpen, onClick: open },
      ready && { label: 'Generate audiobook', icon: Headphones, onClick: () => navigate(`/audio?tab=generate&doc=${doc.id}`) },
      { label: doc.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, onClick: () => patch({ favorite: !doc.favorite }) },
      { label: doc.pinned ? 'Unpin' : 'Pin to top', icon: Pin, onClick: () => patch({ pinned: !doc.pinned }) },
      ready && { label: savedOffline ? 'Remove offline copy' : 'Make available offline', icon: savedOffline ? CloudOff : CloudDownload, onClick: toggleOffline },
      doc.has_file && { label: 'Download original', icon: Download, onClick: () => api.documents.downloadFile(doc.id).catch((e) => notify(e.message, 'error')) },
      { label: 'Edit details', icon: Edit3, onClick: () => onEdit(doc) },
      '-',
      { label: 'Delete', icon: Trash2, onClick: remove, danger: true },
    ]} />
  );

  const statusLine = doc.status === 'processing' ? <span className="status processing"><Loader2 size={11} className="spin" /> Processing…</span>
    : doc.status === 'failed' ? <span className="status failed" title={doc.error}><AlertTriangle size={11} /> {doc.error || 'Failed'}</span>
    : <small>{Math.round(doc.progress)}% · {doc.progress >= 99 ? 'Finished' : `${formatMinutes(doc.minutes_left)} left`} · {timeAgo(doc.last_opened_at || doc.created_at)}</small>;

  const icons = (
    <span className="doc-icons">
      {doc.pinned && <Pin size={12} className="pin-icon" aria-label="Pinned" />}
      {doc.favorite && <Star size={12} className="fav-icon" aria-label="Favorite" fill="currentColor" />}
      {savedOffline && <Download size={12} className="offline-icon" aria-label="Available offline" />}
      {doc.audio_ready && <Headphones size={12} className="audio-icon" aria-label="Audiobook ready" />}
      {busy && <Loader2 size={12} className="spin" />}
    </span>
  );

  if (view === 'list') {
    return (
      <div className={`doc-row ${doc.status}`}>
        <button className="doc-row-main" onClick={open} disabled={!ready}>
          <Cover doc={doc} size="sm" />
          <span className="doc-row-info">
            <span className="doc-type-row"><span className="doc-badge">{doc.format}</span><span className="doc-tag-pill">{doc.type}</span>{(doc.tags || []).slice(0, 2).map((t) => <span key={t} className="doc-tag-pill muted">#{t}</span>)}</span>
            <strong>{doc.title}</strong>
            <small>{doc.author} · {doc.chapter_count} chapters</small>
          </span>
        </button>
        <div className="doc-row-meta"><ProgressBar value={doc.progress} thin />{statusLine}</div>
        {icons}
        {menu}
      </div>
    );
  }

  return (
    <div className={`doc-card ${doc.status}`}>
      <button className="doc-card-main" onClick={open} disabled={!ready} aria-label={`Open ${doc.title}`}>
        <Cover doc={doc} />
        <span className="doc-info">
          <span className="doc-type-row"><span className="doc-badge">{doc.format}</span><span className="doc-tag-pill">{doc.tags?.[0] || doc.type}</span></span>
          <h3>{doc.title}</h3>
          <p>{doc.author}</p>
          <ProgressBar value={doc.progress} thin />
          <span className="doc-foot">{statusLine}{icons}</span>
        </span>
      </button>
      <div className="doc-more">{menu}</div>
    </div>
  );
}

export default function LibraryPage() {
  const { setUploadOpen, dataVersion, refreshData } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(() => new URLSearchParams(window.location.search).get('tag'));
  const [sort, setSort] = useState(() => localStorage.getItem('rv.lib.sort') || 'recent');
  const [view, setView] = useState(() => localStorage.getItem('rv.lib.view') || 'grid');
  const [editing, setEditing] = useState(null);
  const [offlineIds, setOfflineIds] = useState(new Set());
  const q = useDebounce(query, 250);

  useEffect(() => { try { localStorage.setItem('rv.lib.sort', sort); localStorage.setItem('rv.lib.view', view); } catch { /* ignore */ } }, [sort, view]);
  useEffect(() => { offline.list().then((l) => setOfflineIds(new Set(l.map((x) => x.id)))).catch(() => {}); }, [dataVersion]);

  const docs = useQuery(() => api.documents.list({ q, sort, tag: tag || undefined }), [q, sort, tag, dataVersion]);
  const tags = useQuery(() => api.documents.tags(), [dataVersion]);
  const books = useQuery(() => api.audio.list(), [dataVersion], { enabled: tab === 'audiobooks' });

  // poll while something is processing
  const processing = (docs.data || []).some((d) => d.status === 'processing');
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(docs.reload, 2500);
    return () => clearInterval(t);
  }, [processing, docs.reload]);

  const all = docs.data || [];
  const filtered = useMemo(() => {
    switch (tab) {
      case 'BOOK': case 'PAPER': case 'DOCUMENT': return all.filter((d) => d.type === tab);
      case 'favorites': return all.filter((d) => d.favorite);
      case 'offline': return all.filter((d) => offlineIds.has(d.id));
      default: return all;
    }
  }, [all, tab, offlineIds]);

  const replace = (updated) => docs.setData((list) => list.map((d) => (d.id === updated.id ? { ...d, ...updated, chapters: undefined } : d)));
  const remove = (id) => { docs.setData((list) => list.filter((d) => d.id !== id)); refreshData(); };
  const onChangeOffline = (updated) => {
    replace(updated);
    offline.list().then((l) => setOfflineIds(new Set(l.map((x) => x.id)))).catch(() => {});
  };

  const TABS = [
    { id: 'all', label: 'All', count: all.length },
    { id: 'BOOK', label: 'Books' },
    { id: 'PAPER', label: 'Research papers' },
    { id: 'DOCUMENT', label: 'Documents' },
    { id: 'audiobooks', label: 'Audiobooks' },
    { id: 'favorites', label: 'Favorites', count: all.filter((d) => d.favorite).length || undefined },
    { id: 'offline', label: 'Downloads', count: offlineIds.size || undefined },
  ];

  return (
    <div className="page-shell library-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>Library</h1>
        </div>
        <div className="top-actions">
          <button className="primary-button" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload</button>
        </div>
      </header>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="library-tabs" />

      <div className="library-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, author or description" aria-label="Search library" />
          {query && <button className="icon-ghost sm" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}
        </div>
        <div className="toolbar-right">
          <Menu trigger={<span className="sort-button"><ArrowUpDown size={13} /> {SORTS.find((s) => s.id === sort)?.label}</span>} label="Sort"
            items={SORTS.map((s) => ({ label: s.label, checked: s.id === sort, onClick: () => setSort(s.id) }))} />
          <Segmented size="sm" value={view} onChange={setView} label="View" options={[{ value: 'grid', label: '', icon: Grid, title: 'Grid view' }, { value: 'list', label: '', icon: List, title: 'List view' }]} />
        </div>
      </div>

      {tags.data?.length > 0 && tab !== 'audiobooks' && (
        <div className="tag-filter" role="group" aria-label="Filter by tag">
          {tags.data.slice(0, 12).map((t) => (
            <button key={t.tag} className={`chip ${tag === t.tag ? 'active' : ''}`} onClick={() => setTag(tag === t.tag ? null : t.tag)} aria-pressed={tag === t.tag}>
              #{t.tag} <span>{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}

      {tab === 'audiobooks' ? (
        books.loading && !books.data ? <Skeleton h={90} /> : (books.data || []).length === 0 ? (
          <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Choose a narration tone and ReadVibe prepares it in the background." action="Generate audio" onAction={() => navigate('/audio?tab=generate')} />
        ) : (
          <div className="library-list">
            {books.data.map((b) => (
              <div key={b.id} className="doc-row">
                <button className="doc-row-main" onClick={() => navigate(`/audio?book=${b.id}`)}>
                  <div className={`mini-cover mini-cover-sm cover-${b.color}`}><Headphones size={16} /></div>
                  <span className="doc-row-info"><strong>{b.title}</strong><small>{b.tone} narration · {formatDuration(b.duration_seconds)} · {b.chapters.length} chapters</small></span>
                </button>
                <div className="doc-row-meta"><ProgressBar value={b.progress} thin /><small>{b.status === 'ready' ? `${Math.round(b.progress)}% listened` : 'Generating…'}</small></div>
                <button className="play-circle" onClick={() => navigate(`/audio?book=${b.id}`)} aria-label={`Play ${b.title}`}><Play size={14} fill="currentColor" /></button>
              </div>
            ))}
          </div>
        )
      ) : docs.loading && !docs.data ? (
        <div className="library-grid">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} h={118} r={14} />)}</div>
      ) : filtered.length === 0 ? (
        query || tag ? (
          <EmptyState icon={Search} title="No matches" description="Try a different search or clear the tag filter." action="Clear filters" onAction={() => { setQuery(''); setTag(null); }} />
        ) : tab === 'offline' ? (
          <EmptyState icon={CloudDownload} title="Nothing downloaded yet." description="Use “Make available offline” on any document to read it without a connection." />
        ) : tab === 'favorites' ? (
          <EmptyState icon={Star} title="No favorites yet." description="Star documents you return to often." />
        ) : (
          <EmptyState icon={BookOpen} title="Your next reading experience starts here." description="Upload a document to get started." action="Upload document" onAction={() => setUploadOpen(true)} />
        )
      ) : (
        <div className={view === 'grid' ? 'library-grid' : 'library-list'}>
          {filtered.map((doc) => (
            <DocCard key={doc.id} doc={doc} view={view} savedOffline={offlineIds.has(doc.id)}
              onChange={onChangeOffline} onRemove={remove} onEdit={setEditing} />
          ))}
        </div>
      )}

      {all.length > 0 && (
        <div className="offline-banner">
          <CloudDownload size={19} className="offline-cloud" />
          <div>
            <strong>{offlineIds.size ? 'Offline reading is on' : 'Read anywhere'}</strong>
            <p>{offlineIds.size ? `${offlineIds.size} document${offlineIds.size > 1 ? 's are' : ' is'} saved on this device.` : 'Save documents to this device to read them without internet.'}</p>
          </div>
          <button className="text-button" onClick={() => navigate('/settings?tab=storage')}>Manage downloads</button>
        </div>
      )}

      {editing && <EditModal doc={editing} onClose={() => setEditing(null)} onSaved={(d) => { replace(d); setEditing(null); }} />}
    </div>
  );
}
