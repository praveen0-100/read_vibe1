// The shelves shared by the phone and desktop Home, in one order: picked for you (from what you read) → your books → audiobooks →
// more of what you like (from the free catalogue) → recently added → new in Discover. Every tile shows its own cover.
import React from 'react';
import { Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { fetchFresh, searchGutenberg } from '../../lib/catalog';
import { AudioTile, BookCover, BookTile, DiscoverTile, TileSkeletons } from './HomeTiles';

export function Section({ title, hint, onMore, children, className = '' }) {
  return (
    <section className={`am-shelf ${className}`}>
      <header className="am-shelf-head">
        <h2>{title}{hint && <small>{hint}</small>}</h2>
        {onMore && <button onClick={onMore} aria-label={`See all: ${title}`}>See all</button>}
      </header>
      {children}
    </section>
  );
}

/** `middle` is rendered after the first two shelves (the phone puts the daily briefing there). */
export default function HomeShelves({ docs, books, middle = null }) {
  const navigate = useNavigate();
  const { dataVersion } = useApp();
  const open = (path) => () => navigate(path);
  const ready = docs.filter((d) => d.status === 'ready');
  const played = ready.filter((d) => d.last_opened_at);
  const added = [...ready].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 5);
  const audio = (books || []).filter((b) => b.status === 'ready');

  const rec = useQuery(() => api.documents.recommendations(), [dataVersion]);
  const byId = new Map(ready.map((d) => [d.id, d]));
  const picked = (rec.data?.related || []).map((r) => ({ doc: byId.get(r.doc_id), reason: r.reason })).filter((r) => r.doc).slice(0, 10);
  const interest = (rec.data?.interests || [])[0];
  const more = useQuery(() => searchGutenberg({ topic: interest.topic }), [interest?.topic], { enabled: !!interest });
  const owned = new Set(ready.map((d) => `${d.title}`.toLowerCase()));
  const moreItems = (more.data?.items || []).filter((i) => !owned.has(i.title.toLowerCase())).slice(0, 12);
  const fresh = useQuery(() => fetchFresh(), []);
  const discover = fresh.data;

  return (
    <>
      {picked.length > 0 && (
        <Section title="Picked for you" hint="Based on what you read" onMore={open('/library')}>
          <div className="am-row">
            {picked.map(({ doc, reason }) => (
              <div key={doc.id} className="am-picked">
                <BookTile doc={doc} onOpen={open(`/read/${doc.id}`)} />
                <em title={reason}>{reason}</em>
              </div>
            ))}
          </div>
        </Section>
      )}

      {played.length > 0 && (
        <Section title="Recently read" onMore={open('/library')}>
          <div className="am-row">{played.slice(0, 10).map((d) => <BookTile key={d.id} doc={d} onOpen={open(`/read/${d.id}`)} />)}</div>
        </Section>
      )}

      {middle}

      {audio.length > 0 && (
        <Section title="Audiobooks" onMore={open('/audio')}>
          <div className="am-row">{audio.slice(0, 12).map((b) => <AudioTile key={b.id} book={b} onOpen={open(`/audio?book=${b.id}`)} />)}</div>
        </Section>
      )}

      {moreItems.length > 0 && (
        <Section title={`More ${interest.label} to explore`} hint="Free · Project Gutenberg" onMore={open('/discover')}>
          <div className="am-row">{moreItems.map((it) => <DiscoverTile key={it.id} item={it} kind="ebook" onOpen={open('/discover')} />)}</div>
        </Section>
      )}

      {added.length > 0 && (
        <Section title="Recently added" onMore={open('/library')}>
          <div className="am-list">
            {added.map((d) => (
              <button key={d.id} className="am-item" onClick={open(`/read/${d.id}`)}>
                <span className="am-item-cover"><BookCover doc={d} /></span>
                <span className="am-item-text">
                  <strong>{d.title}</strong>
                  <small>{d.author}</small>
                  <span className="am-chip-btn sm"><Play size={11} fill="currentColor" /> Read · {d.minutes_total || '—'}m</span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {fresh.loading && !discover && <Section title="New in Discover"><div className="am-row"><TileSkeletons kind="ebook" n={5} /></div></Section>}
      {discover?.ebooks?.length > 0 && (
        <Section title="New free books" hint="Project Gutenberg" onMore={open('/discover')}>
          <div className="am-row">{discover.ebooks.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="ebook" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
      {discover?.audiobooks?.length > 0 && (
        <Section title="New audiobooks" hint="LibriVox" onMore={open('/discover')}>
          <div className="am-row">{discover.audiobooks.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="audio" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
      {discover?.podcasts?.length > 0 && (
        <Section title="Popular podcasts" onMore={open('/discover')}>
          <div className="am-row">{discover.podcasts.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="podcast" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
    </>
  );
}
