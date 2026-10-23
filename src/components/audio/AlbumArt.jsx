// Square, animated album art — drifting aurora, film grain, moving sheen and glowing type.
import React from 'react';
import { ListMusic } from 'lucide-react';

const hash = (s = '') => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const unit = (h, n) => ((h >>> (n * 5)) & 31) / 31; // 0..1, independent per n

/** Per-album variation so two albums of the same colour still look different. */
function variation(seed) {
  const h = hash(seed);
  return {
    '--x1': `${10 + unit(h, 0) * 40}%`, '--y1': `${5 + unit(h, 1) * 40}%`,
    '--x2': `${45 + unit(h, 2) * 45}%`, '--y2': `${40 + unit(h, 3) * 50}%`,
    '--x3': `${unit(h, 4) * 70}%`, '--y3': `${50 + unit(h, 5) * 45}%`,
    '--spd': `${16 + unit(h, 1) * 10}s`, '--rot': `${Math.round(unit(h, 2) * 360)}deg`,
    '--delay': `${-unit(h, 3) * 12}s`,
  };
}

export default function AlbumArt({ title = '', kicker = '', color = 'coral', playing = false, size = 'md', bare = false, className = '' }) {
  return (
    <div className={`album-art aa-${size} pal-${color} ${playing ? 'is-playing' : ''} ${className}`} style={variation(`${title}|${color}`)} aria-hidden="true">
      <i className="aa-blob b1" /><i className="aa-blob b2" /><i className="aa-blob b3" />
      <i className="aa-ring" />
      <i className="aa-grain" /><i className="aa-sheen" />
      {!bare && (
        <div className="aa-text">
          {kicker && <span className="aa-kicker">{kicker}</span>}
          <strong className="aa-title">{title}</strong>
        </div>
      )}
      {playing && <span className="aa-eq"><i /><i /><i /><i /></span>}
    </div>
  );
}

/** Playlist art: a living mosaic of its albums with the playlist name glowing across it. */
export function PlaylistArt({ name = '', books = [], playing = false, size = 'md', className = '' }) {
  const tiles = books.slice(0, 4);
  const pal = tiles[0]?.color || 'lavender';
  return (
    <div className={`album-art playlist-art aa-${size} pal-${pal} ${playing ? 'is-playing' : ''} ${className}`} style={variation(`pl|${name}`)} aria-hidden="true">
      <i className="aa-blob b1" /><i className="aa-blob b2" /><i className="aa-blob b3" />
      {tiles.length > 1 && (
        <div className={`pa-mosaic n${Math.min(tiles.length, 4)}`}>
          {tiles.map((b) => <AlbumArt key={b.id} title={b.title} color={b.color} size="tile" bare />)}
        </div>
      )}
      {tiles.length < 2 && <ListMusic className="pa-icon" strokeWidth={1.2} />}
      <i className="aa-grain" /><i className="aa-sheen" />
      <div className="aa-text pa-text"><strong className="aa-title">{name}</strong></div>
      {playing && <span className="aa-eq"><i /><i /><i /><i /></span>}
    </div>
  );
}
