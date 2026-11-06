// "Add books": pick several books — from your library or straight from the Discover catalogue — and line them up in the queue like
// the tracks of a playlist. Catalogue books are imported, turned into audiobooks and queued, in the order you picked them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Compass, Library, ListMusic, Loader2, Search } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useAsync';
import { bookKey, createOrderedQueuer } from '../../lib/batchQueue';
import { GENRES, searchGutenberg } from '../../lib/catalog';
import { playlistActions } from '../../lib/playlists';
import { getQueue, queueActions } from '../../lib/queue';
import { getPlayback, playbackActions } from '../../features/playback/playbackStore';
import { Modal, Skeleton } from '../ui';

const MAX_PICKS = 12;
const IMPORTED = 'rv.catalog.imported'; // shared with the Discover page, so a book is never imported twice
const imported = {
  get: () => { try { return JSON.parse(localStorage.getItem(IMPORTED)) || {}; } catch { return {}; } },
  set: (k, id) => { try { localStorage.setItem(IMPORTED, JSON.stringify({ ...imported.get(), [k]: id })); } catch { /* private mode */ } },
};

function Thumb({ title, cover }) {
  const [bad, setBad] = useState(false);
  return <span className="ab-thumb">{cover && !bad ? <img src={cover} alt="" loading="lazy" onError={() => setBad(true)} /> : <b>{title.slice(0, 2).toUpperCase()}</b>}</span>;
}

export default function AddBooksSheet({ library = [], onClose }) {
  const { notify, trackJob, refreshData, dataVersion } = useApp();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion]);
  const [tab, setTab] = useState('library');
  const [picks, setPicks] = useState([]); // [{ key, kind: 'doc' | 'catalog', doc?, item?, title }] in the order chosen
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState(GENRES[0].id);
  const [results, setResults] = useState({ items: [], next: false, loading: false, error: null, page: 1 });
  const [saveList, setSaveList] = useState(false);
  const [listName, setListName] = useState('');
  const [busy, setBusy] = useState(false);
  const dq = useDebounce(q.trim(), 400);
  const reqId = useRef(0);

  const audioByDoc = useMemo(() => { const m = new Map(); library.forEach((b) => { if (b.status === 'ready' || !m.has(b.document_id)) m.set(b.document_id, b); }); return m; }, [library]);
  const readyDocs = (docs.data || []).filter((d) => d.status === 'ready');
  const has = (key) => picks.some((p) => p.key === key);
  const toggle = (pick) => setPicks((l) => (l.some((p) => p.key === pick.key) ? l.filter((p) => p.key !== pick.key) : l.length >= MAX_PICKS ? (notify(`Pick up to ${MAX_PICKS} books at a time`, 'info'), l) : [...l, pick]));

  // catalogue search (Project Gutenberg, via the same backend feed the Discover page uses)
  const search = useCallback(async (page) => {
    const id = ++reqId.current;
    setResults((r) => ({ ...r, loading: true, error: null }));
    try {
      const g = GENRES.find((x) => x.id === genre);
      const d = await searchGutenberg({ q: dq || undefined, topic: dq ? undefined : g?.topic, page });
      if (id !== reqId.current) return;
      setResults((r) => ({ items: page === 1 ? d.items : [...r.items, ...d.items], next: d.next, loading: false, error: null, page }));
    } catch (e) { if (id === reqId.current) setResults((r) => ({ ...r, loading: false, error: e.message || 'Couldn’t reach the catalogue' })); }
  }, [dq, genre]);
  useEffect(() => { if (tab === 'discover') search(1); }, [tab, search]);

  // ── the batch: import → audiobook → queue, delivered in the order chosen ──
  const start = async () => {
    if (!picks.length || busy) return;
    setBusy(true);
    const chosen = [...picks];
    const name = saveList ? (listName.trim() || `Discover mix · ${new Date().toLocaleDateString()}`) : null;
    let first = true;
    const queuer = createOrderedQueuer(
      chosen.length,
      (book) => {
        // The first book you picked becomes "Now playing" (paused) when nothing is being listened to and the loaded album is untouched,
        // so the queue reads in the order you chose; everything else lines up behind it.
        const cur = getPlayback();
        const loaded = library.find((b) => b.id === cur.bookId);
        const untouched = !loaded || (loaded.listened_seconds || 0) === 0;
        if (first && !cur.playing && untouched && getQueue().queue.length === 0) playbackActions.open(book.id);
        else queueActions.add(book);
        first = false;
      },
      (books) => {
        refreshData();
        if (books.length) notify(`${books.length} book${books.length === 1 ? '' : 's'} added to your queue${name ? ` and saved as “${name}”` : ''}`);
        if (name && books.length) playlistActions.create(name, books.map((b) => b.id));
      },
    );
    notify(`Preparing ${chosen.length} book${chosen.length === 1 ? '' : 's'} — they’ll join your queue in this order as they’re ready`, 'info');
    onClose();
    await Promise.all(chosen.map(async (p, i) => {
      try {
        let docId = p.doc?.id;
        if (!docId) {
          const known = imported.get()[p.key];
          const title = bookKey(p.item.title, p.item.author);
          docId = (known && (docs.data || []).some((d) => d.id === known) ? known : null) || (docs.data || []).find((d) => bookKey(d.title, d.author) === title)?.id;
          if (!docId) {
            const doc = await api.documents.importCatalog({ source: p.item.source, id: p.item.id, title: p.item.title, author: p.item.author, tags: p.item.tags || [] });
            imported.set(p.key, doc.id);
            docId = doc.id;
          }
        }
        const existing = audioByDoc.get(docId);
        if (existing && existing.status === 'ready') { queuer.ready(i, existing); return; }
        const res = await api.audio.create({ document_id: docId, tone: 'Regular' });
        trackJob(res.job_id, async (job) => {
          if (job.status !== 'completed') { notify(job.status === 'failed' ? `Couldn’t make “${p.title}”: ${job.error || 'it failed'}` : `“${p.title}” was cancelled`, 'error'); queuer.fail(i); return; }
          try { queuer.ready(i, await api.audio.get(res.audiobook.id)); } catch { queuer.fail(i); }
        });
      } catch (e) { notify(`“${p.title}”: ${e.message || 'couldn’t be added'}`, 'error'); queuer.fail(i); }
    }));
  };

  const row = (key, pick, title, sub, cover, badge) => (
    <li key={key}>
      <label className={`ab-row ${has(key) ? 'on' : ''}`}>
        <input type="checkbox" checked={has(key)} onChange={() => toggle({ key, title, ...pick })} />
        <Thumb title={title} cover={cover} />
        <span className="ab-text"><strong>{title}</strong><small>{sub}</small></span>
        {badge && <em className="ab-badge">{badge}</em>}
        {has(key) && <span className="ab-order" aria-label={`Position ${picks.findIndex((p) => p.key === key) + 1}`}>{picks.findIndex((p) => p.key === key) + 1}</span>}
      </label>
    </li>
  );

  return (
    <Modal open onClose={onClose} eyebrow="ADD TO QUEUE" title="Add books" icon={ListMusic} size="lg" className="add-books-modal"
      footer={(
        <div className="ab-foot">
          <label className="ab-save"><input type="checkbox" checked={saveList} onChange={(e) => setSaveList(e.target.checked)} /> Also save as a playlist</label>
          {saveList && <input className="input ab-name" maxLength={60} value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Playlist name" aria-label="Playlist name" />}
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!picks.length || busy} onClick={start}>{busy ? <Loader2 size={14} className="spin" /> : <ListMusic size={14} />} Add {picks.length || ''} {picks.length === 1 ? 'book' : 'books'}</button>
        </div>
      )}>
      <div className="ab-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}><Library size={14} /> My library</button>
        <button role="tab" aria-selected={tab === 'discover'} className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}><Compass size={14} /> Discover</button>
        <span className="ab-count">{picks.length ? `${picks.length} selected · plays in this order` : 'Pick one or more'}</span>
      </div>

      {tab === 'library' && (
        docs.loading && !docs.data ? <Skeleton h={180} /> : readyDocs.length === 0 ? (
          <p className="muted ab-empty">Your library is empty. Switch to <b>Discover</b> to find free books to listen to.</p>
        ) : (
          <ul className="ab-list">
            {readyDocs.map((d) => {
              const a = audioByDoc.get(d.id);
              return row(`doc:${d.id}`, { kind: 'doc', doc: d }, d.title, d.author, null, a?.status === 'ready' ? 'Audio ready' : a ? 'Generating…' : 'Will make audio');
            })}
          </ul>
        )
      )}

      {tab === 'discover' && (
        <>
          <div className="ab-search">
            <Search size={14} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search free books by title or author" aria-label="Search the catalogue" />
          </div>
          {!dq && (
            <div className="ab-genres" role="group" aria-label="Genres">
              {GENRES.map((g) => <button key={g.id} className={`chip ${genre === g.id ? 'active' : ''}`} aria-pressed={genre === g.id} onClick={() => setGenre(g.id)}>{g.label}</button>)}
            </div>
          )}
          {results.error && <p className="field-error">{results.error} <button className="text-button" onClick={() => search(1)}>Try again</button></p>}
          {results.loading && !results.items.length ? <Skeleton h={220} /> : (
            <ul className="ab-list">
              {results.items.map((it) => {
                const key = `${it.source}:${it.id}`;
                const inLib = (docs.data || []).find((d) => bookKey(d.title, d.author) === bookKey(it.title, it.author));
                return row(key, { kind: 'catalog', item: it }, it.title, `${it.author} · ${it.meta}`, it.cover, inLib ? 'In your library' : null);
              })}
            </ul>
          )}
          {!results.loading && !results.items.length && !results.error && <p className="muted ab-empty">No books found. Try another search.</p>}
          {results.next && <button className="secondary-button ab-more" disabled={results.loading} onClick={() => search(results.page + 1)}>{results.loading ? <Loader2 size={14} className="spin" /> : null} Load more</button>}
          <p className="fineprint"><Check size={11} /> Free, public-domain books from Project Gutenberg. Each is imported to your library, narrated, and queued.</p>
        </>
      )}
    </Modal>
  );
}
