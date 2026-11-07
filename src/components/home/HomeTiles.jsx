// The tiles of the phone Home. Each kind of thing has its own shape so the shelves never read as one grey grid:
//   books → tall portrait covers · audiobooks → square album art with a play badge · podcasts → rounded artwork with a mic badge
// Every tile shows the item's OWN cover when it has one; without one it gets a poster generated from its title (so no two look alike).
import React, { useState } from 'react';
import { Headphones, Mic, Play } from 'lucide-react';
import { useCoverUrl } from '../../lib/covers';
import AlbumArt from '../audio/AlbumArt';

const hash = (s = '') => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The hue a title's generated poster uses, so a panel built around the book can share its colour. */
export const posterHue = (title = '') => hash(title) % 360;

/** A book jacket made from the title: its own hue, one of four motifs, title set like a cover. */
export function Poster({ title = '', author = '', tag = '' }) {
  const h = hash(title);
  const hue = h % 360;
  const motif = (h >>> 9) % 4;
  const style = {
    '--ph': hue,
    background: `linear-gradient(160deg, hsl(${hue} 52% 40%), hsl(${(hue + 38) % 360} 58% 22%))`,
  };
  return (
    <div className={`hp-poster m${motif}`} style={style} aria-hidden="true">
      <i className="hp-motif" />
      {tag && <small className="hp-tag">{tag}</small>}
      <strong>{title.length > 64 ? `${title.slice(0, 62)}…` : title}</strong>
      {author && <em>{author}</em>}
    </div>
  );
}

/** Image with the generated poster underneath: if the picture is missing or fails to load, the poster simply stays. */
function Pic({ src, fallback, className = '' }) {
  const [bad, setBad] = useState(false);
  return (
    <>
      {fallback}
      {src && !bad && <img className={`hp-img ${className}`} src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} onLoad={(e) => { if (e.currentTarget.naturalWidth < 24) setBad(true); }} />}
    </>
  );
}

function Progress({ value }) {
  if (!(value > 0)) return null;
  return <span className="hp-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(value))}%` }} /></span>;
}

/** Cover of a document in the user's library. */
export function BookCover({ doc, className = '' }) {
  const url = useCoverUrl(doc?.has_cover ? doc.id : null);
  return (
    <span className={`hp-book ${className}`}>
      <Pic src={url} fallback={<Poster title={doc.title} author={doc.author} tag={doc.tags?.[0]} />} />
    </span>
  );
}

export function BookTile({ doc, onOpen }) {
  return (
    <button className="am-tile hp-tile-book" onClick={onOpen}>
      <span className="hp-cover"><BookCover doc={doc} /><Progress value={doc.progress} /></span>
      <strong>{doc.title}</strong>
      <small>{doc.author}</small>
    </button>
  );
}

export function AudioTile({ book, onOpen }) {
  return (
    <button className="am-tile hp-tile-audio" onClick={onOpen}>
      <span className="hp-cover">
        <AlbumArt title={book.title} color={book.color || 'blue'} cover={book.cover ?? (book.document_has_cover ? book.document_id : null)} size="tile" />
        <span className="hp-badge play"><Play size={15} fill="currentColor" /></span>
        <Progress value={book.progress} />
      </span>
      <strong>{book.title}</strong>
      <small>{book.progress > 0 && book.progress < 100 ? `${Math.round(book.progress)}% listened` : book.tone || 'Audiobook'}</small>
    </button>
  );
}

/** Something from Discover: an e-book, an audiobook or a podcast, with the picture the catalogue publishes for it. */
export function DiscoverTile({ item, kind, onOpen }) {
  const icon = kind === 'podcast' ? <Mic size={14} /> : kind === 'audio' ? <Headphones size={14} /> : null;
  return (
    <button className={`am-tile hp-tile-${kind}`} onClick={onOpen}>
      <span className="hp-cover">
        <Pic src={item.cover} fallback={<Poster title={item.title} author={item.author} tag={kind === 'podcast' ? 'Podcast' : kind === 'audio' ? 'Audiobook' : ''} />} />
        {icon && <span className="hp-badge">{icon}</span>}
      </span>
      <strong>{item.title}</strong>
      <small>{item.author}</small>
    </button>
  );
}

export function TileSkeletons({ kind = 'book', n = 4 }) {
  return Array.from({ length: n }, (_, i) => <span key={i} className={`am-tile hp-tile-${kind} hp-skel`}><span className="hp-cover" /><strong>&nbsp;</strong></span>);
}
