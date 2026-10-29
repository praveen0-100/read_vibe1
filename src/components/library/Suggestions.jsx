// "Suggested for you": browse the library by category, see related unfinished books (with the reason), and discover new
// free books for the topics the user actually reads. Category chips filter the library below.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Check, Compass, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { GENRES, searchGutenberg } from '../../lib/catalog';
import { Cover, Skeleton } from '../ui';

const STARTERS = ['fiction', 'philosophy', 'science', 'history'];
const norm = (s = '') => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function Shelf({ title, hint, children }) {
  return (
    <section className="sg-shelf">
      <header><h3>{title}</h3>{hint && <small>{hint}</small>}</header>
      <div className="sg-rail">{children}</div>
    </section>
  );
}

function RelatedCard({ doc, rel, onOpen }) {
  return (
    <button className="sg-card" onClick={() => onOpen(doc.id)} aria-label={`Open ${doc.title}`}>
      <Cover doc={doc} />
      <span className="sg-card-info">
        <strong>{doc.title}</strong>
        <small>{doc.author}</small>
        <em><Sparkles size={11} /> {rel.reason}</em>
      </span>
    </button>
  );
}

function NewBookCard({ book, added, busy, onAdd }) {
  return (
    <div className="sg-card sg-new">
      {book.cover ? <img src={book.cover} alt="" loading="lazy" /> : <div className="sg-nocover"><BookOpen size={20} /></div>}
      <span className="sg-card-info">
        <strong>{book.title}</strong>
        <small>{book.author}</small>
        {book.tags?.[0] && <em>#{book.tags[0]}</em>}
        <button className={`sg-add ${added ? 'done' : ''}`} onClick={() => onAdd(book)} disabled={added || busy} aria-label={`Add ${book.title} to library`}>
          {busy ? <Loader2 size={12} className="spin" /> : added ? <Check size={12} /> : <Plus size={12} />} {added ? 'In library' : 'Add'}
        </button>
      </span>
    </div>
  );
}

export default function Suggestions({ docs, rec, category, onCategory }) {
  const navigate = useNavigate();
  const { notify, refreshData } = useApp();
  const [shelves, setShelves] = useState(null); // [{id, label, books}]
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(new Set());
  const [added, setAdded] = useState(new Set());
  const [attempt, setAttempt] = useState(0);

  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const ownedKey = docs.map((d) => norm(d.title)).sort().join('|');
  const owned = useMemo(() => new Set(ownedKey ? ownedKey.split('|') : []), [ownedKey]);
  const topics = useMemo(() => {
    if (!rec) return null;
    const mine = rec.interests.slice(0, 3).map((i) => ({ id: i.id, label: i.label, topic: i.topic }));
    return mine.length ? mine : STARTERS.map((id) => GENRES.find((g) => g.id === id)).map((g) => ({ id: g.id, label: g.label, topic: g.topic, starter: true }));
  }, [rec]);

  useEffect(() => {
    if (!topics) return undefined;
    let live = true;
    setShelves(null);
    setFailed(false);
    Promise.allSettled(topics.map((t) => searchGutenberg({ topic: t.topic }))).then((res) => {
      if (!live) return;
      const seen = new Set();
      const out = topics.map((t, i) => {
        const books = res[i].status === 'fulfilled' ? res[i].value.items : [];
        const fresh = books.filter((b) => {
          const k = norm(b.title);
          if (owned.has(k) || seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 8);
        return { ...t, books: fresh };
      }).filter((s) => s.books.length);
      setShelves(out);
      setFailed(res.every((r) => r.status === 'rejected'));
    });
    return () => { live = false; };
  }, [topics, owned, attempt]);

  const add = async (book) => {
    setAdding((s) => new Set(s).add(book.id));
    try {
      await api.documents.importCatalog({ source: book.source, id: book.id, title: book.title, author: book.author, tags: book.tags || [] });
      setAdded((s) => new Set(s).add(book.id));
      notify(`Added “${book.title}” to your library`, 'success');
      refreshData();
    } catch (err) { notify(err.message, 'error'); } finally {
      setAdding((s) => { const n = new Set(s); n.delete(book.id); return n; });
    }
  };

  if (!rec || docs.length === 0) return null;
  const related = rec.related.map((r) => ({ rel: r, doc: byId.get(r.doc_id) })).filter((x) => x.doc);
  const cats = rec.categories.filter((c) => c.doc_ids.length);

  return (
    <section className="suggest" aria-label="Suggested for you">
      <header className="suggest-head">
        <div><div className="eyebrow">SUGGESTED FOR YOU</div><h2>Explore by what you love</h2></div>
        {category && <button className="text-button small" onClick={() => onCategory(null)}>Show everything</button>}
      </header>

      <div className="tag-filter sg-cats" role="group" aria-label="Browse by category">
        {cats.map((c) => (
          <button key={c.id} className={`chip ${category === c.id ? 'active' : ''}`} onClick={() => onCategory(category === c.id ? null : c.id)} aria-pressed={category === c.id}>
            {c.label} <span>{c.doc_ids.length}</span>
          </button>
        ))}
      </div>

      {!category && related.length > 0 && (
        <Shelf title="Related to what you’re reading" hint="From your own library">
          {related.map(({ rel, doc }) => <RelatedCard key={doc.id} doc={doc} rel={rel} onOpen={(id) => navigate(`/read/${id}`)} />)}
        </Shelf>
      )}

      {!category && (shelves === null ? (
        <Shelf title="Finding books you’ll like…"><Skeleton h={150} r={14} /><Skeleton h={150} r={14} /><Skeleton h={150} r={14} /></Shelf>
      ) : failed ? (
        <p className="sg-note"><Compass size={14} /> Couldn’t reach the free book catalogue. <button className="text-button small" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={12} /> Try again</button></p>
      ) : shelves.map((s) => (
        <Shelf key={s.id} title={s.starter ? `Start with ${s.label}` : `More in ${s.label}`} hint={s.starter ? 'Free classics to begin your collection' : 'Free books matched to your reading'}>
          {s.books.map((b) => <NewBookCard key={b.id} book={b} added={added.has(b.id)} busy={adding.has(b.id)} onAdd={add} />)}
        </Shelf>
      )))}
    </section>
  );
}
