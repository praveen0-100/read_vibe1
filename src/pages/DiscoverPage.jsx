// Discover: free e-books, audiobooks, podcasts and learning resources from open sources, with live "new arrivals".
// Everything opens inside the app: books import into the reader, audio plays in the built-in player.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, BookOpen, ExternalLink, GraduationCap, Headphones, Library, Mic, FileText, Play, Search, Sparkles, X } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import {
  GENRES, RESOURCES, audiobookTracks, fetchFresh, followedUpdates, podcastEpisodes, searchArchiveTexts, searchAudiobooks, searchGutenberg, searchPodcasts,
} from '../lib/catalog';
import { EmptyState, Skeleton } from '../components/ui';
import DiscoverListen from '../components/audio/DiscoverListen';

const TABS = [
  { id: 'new', label: 'New', icon: Sparkles },
  { id: 'ebooks', label: 'E-books', icon: BookOpen },
  { id: 'audiobooks', label: 'Audiobooks', icon: Headphones },
  { id: 'podcasts', label: 'Podcasts', icon: Mic },
  { id: 'learn', label: 'Courses & links', icon: GraduationCap },
];

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const SEEN = 'rv.discover.seen';
const FOLLOWS = 'rv.podcast.follows';
const IMPORTED = 'rv.catalog.imported';

function ago(ms) {
  const h = Math.max(0, Date.now() - ms) / 36e5;
  return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Cover({ item }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="dc-cover">
      {item.cover && !bad
        ? <img src={item.cover} alt="" loading="lazy" onError={() => setBad(true)} />
        : <span>{item.title.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

/** Full text of an e-book, shown as a transcript; chapters load one at a time. */
function Transcript({ item, docId, onClose }) {
  const [chapters, setChapters] = useState([]);
  const [total, setTotal] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const next = useRef(0);

  const more = useCallback(async () => {
    setLoading(true);
    try {
      const ch = await api.documents.chapter(docId, next.current);
      const text = new DOMParser().parseFromString(ch.content || '', 'text/html').body.textContent.trim();
      next.current += 1;
      setTotal(ch.total);
      setChapters((c) => [...c, { title: ch.title, text }]);
    } catch (e) { setError(e.message || 'Couldn’t load the text'); } finally { setLoading(false); }
  }, [docId]);

  useEffect(() => { more(); }, [more]);
  const done = total !== null && next.current >= total;
  return (
    <div className="dc-transcript" role="dialog" aria-label={`Transcript of ${item.title}`}>
      <div className="dc-player-head">
        <Cover item={item} />
        <div className="dc-player-text"><strong>{item.title}</strong><small>Transcript · {item.author}</small></div>
        <button className="icon-ghost" onClick={onClose} aria-label="Close transcript"><X size={20} /></button>
      </div>
      <div className="dc-transcript-body">
        {chapters.map((c, n) => (
          <section key={n}>
            <h3>{c.title}</h3>
            {c.text.split(/\n{2,}/).map((para, k) => <p key={k}>{para}</p>)}
          </section>
        ))}
        {error && <p className="dc-note">{error}</p>}
        {!done && !error && <button className="dc-more" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Load next chapter'}</button>}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { notify, notifyError, refreshData } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('new');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState(null);
  const [archive, setArchive] = useState(false);
  const [state, setState] = useState({ items: [], next: false, loading: false, error: null });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const [player, setPlayer] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [fresh, setFresh] = useState({ loading: true, error: null, data: null });
  const [follows, setFollows] = useState(() => store.get(FOLLOWS, []));
  const [updates, setUpdates] = useState([]);
  const seen = useRef(store.get(SEEN, { gut: 0, lib: 0 }));
  const newest = useRef({ gut: 0, lib: 0 });

  const isNew = (it) => (it.source === 'gutenberg' && it.rank > seen.current.gut) || (it.source === 'librivox' && it.rank > seen.current.lib);

  const loadFresh = useCallback(async () => {
    setFresh((f) => ({ ...f, loading: true, error: null }));
    try {
      const data = await fetchFresh();
      newest.current = {
        gut: Math.max(seen.current.gut, ...data.ebooks.map((b) => b.rank)),
        lib: Math.max(seen.current.lib, ...data.audiobooks.map((b) => b.rank)),
      };
      setFresh({ loading: false, error: null, data });
    } catch (e) { setFresh({ loading: false, error: e.message, data: null }); }
  }, []);

  // Remember what has been seen when leaving, so only genuinely new arrivals are flagged next visit.
  useEffect(() => () => { if (newest.current.gut || newest.current.lib) store.set(SEEN, newest.current); }, []);
  useEffect(() => { loadFresh(); }, [loadFresh]);
  useEffect(() => {
    let live = true;
    if (follows.length) followedUpdates(follows).then((u) => live && setUpdates(u));
    else setUpdates([]);
    return () => { live = false; };
  }, [follows]);

  const toggleFollow = (it) => {
    const on = follows.some((f) => f.id === it.id);
    const next = on ? follows.filter((f) => f.id !== it.id) : [...follows, { id: it.id, title: it.title, author: it.author, cover: it.cover }];
    setFollows(next);
    store.set(FOLLOWS, next);
    notify(on ? `Unfollowed ${it.title}` : `Following ${it.title} — new episodes will appear under New`);
  };

  const run = useCallback(async (pg) => {
    setState((s) => ({ ...s, loading: true, error: null, items: pg === 1 ? [] : s.items }));
    try {
      let r;
      if (tab === 'ebooks') r = archive ? await searchArchiveTexts({ q: query, page: pg }) : await searchGutenberg({ q: query, topic: GENRES.find((g) => g.id === genre)?.topic, page: pg });
      else if (tab === 'audiobooks') r = await searchAudiobooks({ q: query, page: pg });
      else r = await searchPodcasts({ q: query });
      setState((s) => ({ items: pg === 1 ? r.items : [...s.items, ...r.items], next: r.next, loading: false, error: null }));
    } catch (e) {
      setState({ items: [], next: false, loading: false, error: e.message });
    }
  }, [tab, query, genre, archive]);

  useEffect(() => { if (tab !== 'learn' && tab !== 'new') { setPage(1); run(1); } }, [run, tab]);

  // Import the title into the library (once) and return its document id.
  const ensureDoc = async (item) => {
    const key = `${item.source}:${item.id}`;
    const known = store.get(IMPORTED, {})[key];
    if (known) {
      try { await api.documents.get(known); return known; } catch { /* deleted since — import again */ }
    }
    const doc = await api.documents.importCatalog({ source: item.source, id: item.id, title: item.title, author: item.author, tags: item.tags || [] });
    store.set(IMPORTED, { ...store.get(IMPORTED, {}), [key]: doc.id });
    refreshData?.();
    return doc.id;
  };

  // One tap: open it in the in-app reader.
  const readNow = async (item) => {
    setBusy(item.id);
    try { navigate(`/read/${await ensureDoc(item)}`); } catch (e) {
      notifyError(e, 'Couldn’t open this title');
    } finally { setBusy(null); }
  };

  const showTranscript = async (item) => {
    setBusy(`t:${item.id}`);
    try { setTranscript({ item, docId: await ensureDoc(item) }); } catch (e) {
      notifyError(e, 'Couldn’t load the transcript');
    } finally { setBusy(null); }
  };

  const listen = async (item) => {
    setBusy(item.id);
    try {
      const tracks = item.source === 'podcast' ? await podcastEpisodes(item.id) : await audiobookTracks(item.id);
      if (!tracks.length) throw new Error('No playable audio found for this title');
      setPlayer({ item, tracks });
    } catch (e) { notifyError(e); } finally { setBusy(null); }
  };

  const card = (it) => {
    const following = follows.some((f) => f.id === it.id);
    const isBook = it.source === 'gutenberg' || it.source === 'archive';
    return (
      <article key={`${it.source}-${it.id}`} className="dc-card">
        {isNew(it) && <span className="dc-new">NEW</span>}
        <Cover item={it} />
        <div className="dc-info">
          <h3>{it.title}</h3>
          <p>{it.author}</p>
          <small>{it.meta}</small>
        </div>
        <div className="dc-actions">
          {isBook && <button className="dc-btn" onClick={() => readNow(it)} disabled={busy === it.id}><BookOpen size={14} /> {busy === it.id ? 'Opening…' : 'Read now'}</button>}
          {isBook && <button className="dc-btn ghost" onClick={() => showTranscript(it)} disabled={busy === `t:${it.id}`}><FileText size={14} /> {busy === `t:${it.id}` ? 'Loading…' : 'Transcript'}</button>}
          {!isBook && <button className="dc-btn" onClick={() => listen(it)} disabled={busy === it.id}><Play size={14} fill="currentColor" /> {busy === it.id ? 'Loading…' : 'Listen'}</button>}
          {it.source === 'podcast' && (
            <button className={`dc-btn ghost ${following ? 'on' : ''}`} onClick={() => toggleFollow(it)} aria-pressed={following}><BellRing size={14} /> {following ? 'Following' : 'Follow'}</button>)}
        </div>
      </article>
    );
  };

  const submit = (e) => { e.preventDefault(); setQuery(q.trim()); };
  const searching = tab !== 'learn' && tab !== 'new';

  return (
    <div className="page-shell discover-page">
      <header className="dc-head">
        <h1>Discover</h1>
        <p>Free e-books, audiobooks, podcasts and courses — public domain and openly licensed, refreshed live.</p>
      </header>

      <div className="dc-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setGenre(null); }}><Icon size={16} /> {label}</button>
        ))}
      </div>

      {tab === 'new' && (
        <div className="dc-new-tab">
          {fresh.error && <EmptyState icon={Library} title="Couldn’t load new arrivals" description={fresh.error} action="Try again" onAction={loadFresh} />}
          {updates.length > 0 && (
            <section>
              <h2>New episodes from shows you follow</h2>
              <div className="dc-updates">
                {updates.map(({ show, ep }) => (
                  <button key={show.id} onClick={() => setPlayer({ item: show, tracks: [ep] })}>
                    <Cover item={show} /><span><strong>{ep.title}</strong><small>{show.title} · {ago(ep.released)}</small></span><Play size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {[['New e-books', 'ebooks'], ['New audiobooks', 'audiobooks'], ['Trending podcasts', 'podcasts']].map(([title, key]) => (
            <section key={key}>
              <h2>{title}<button onClick={() => setTab(key)}>See all</button></h2>
              <div className="dc-rail">
                {fresh.loading && !fresh.data && Array.from({ length: 3 }, (_, n) => <Skeleton key={n} h={150} w={300} r={16} />)}
                {(fresh.data?.[key] || []).map(card)}
              </div>
            </section>
          ))}
          <p className="dc-note">Updated live from Project Gutenberg, LibriVox and the Apple Podcasts charts. Items added since your last visit are marked NEW.</p>
        </div>
      )}

      {searching && (
        <>
          <form className="dc-search" onSubmit={submit} role="search">
            <Search size={18} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'podcasts' ? 'Search podcasts' : tab === 'audiobooks' ? 'Search audiobooks by title or author' : 'Search by title or author'} aria-label="Search" />
            {q && <button type="button" className="icon-ghost sm" onClick={() => { setQ(''); setQuery(''); }} aria-label="Clear"><X size={16} /></button>}
          </form>

          {tab === 'ebooks' && (
            <div className="dc-chips" role="group" aria-label="Genres">
              <button className={`dc-chip src ${archive ? '' : 'on'}`} onClick={() => setArchive(false)}>Project Gutenberg</button>
              <button className={`dc-chip src ${archive ? 'on' : ''}`} onClick={() => { setArchive(true); setGenre(null); }}>Internet Archive</button>
              {!archive && GENRES.map((g) => (
                <button key={g.id} className={`dc-chip ${genre === g.id ? 'on' : ''}`} onClick={() => setGenre(genre === g.id ? null : g.id)}>{g.label}</button>
              ))}
            </div>
          )}

          {state.error && <EmptyState icon={Library} title="Couldn’t load the catalog" description={state.error} action="Try again" onAction={() => run(1)} />}
          {!state.error && !state.loading && state.items.length === 0 && <EmptyState icon={Search} title="Nothing found" description="Try a different title, author or genre." />}

          <div className="dc-grid">
            {state.items.map(card)}
            {state.loading && Array.from({ length: 6 }, (_, n) => <Skeleton key={n} h={150} r={16} />)}
          </div>

          {state.next && !state.loading && (
            <button className="dc-more" onClick={() => { const n = page + 1; setPage(n); run(n); }}>Load more</button>
          )}
        </>
      )}

      {tab === 'learn' && (
        <div className="dc-resources">
          {RESOURCES.map((g) => (
            <section key={g.group}>
              <h2>{g.group}</h2>
              <div className="dc-links">
                {g.items.map((r) => (
                  <a key={r.url} href={r.url} target="_blank" rel="noreferrer noopener">
                    <span><strong>{r.name}</strong><small>{r.note}</small></span>
                    <ExternalLink size={16} />
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {transcript && <Transcript key={transcript.docId} {...transcript} onClose={() => setTranscript(null)} />}
      {player && <DiscoverListen item={player.item} tracks={player.tracks} onClose={() => setPlayer(null)} />}
    </div>
  );
}
