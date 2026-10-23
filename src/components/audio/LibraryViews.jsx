// Album grid and playlists for the Audio Studio.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, Download, Headphones, ListEnd, ListMusic, ListPlus, ListStart, Loader2, Pencil, Play, Plus, Shuffle, Trash2,
} from 'lucide-react';
import { formatDuration, timeAgo } from '../../lib/format';
import { playlistActions, usePlaylists } from '../../lib/playlists';
import { queueActions } from '../../lib/queue';
import { EmptyState, Field, Menu, Modal, ProgressBar } from '../ui';
import AlbumArt, { PlaylistArt } from './AlbumArt';

/** Shared "⋯" menu items for an album. */
export function albumMenuItems(book, { lists, onNewPlaylist, onPlay, extra = [] }) {
  return [
    { label: 'Play', icon: Play, onClick: () => onPlay(book.id) },
    { label: 'Play next', icon: ListStart, onClick: () => queueActions.add(book, { next: true }) },
    { label: 'Add to queue', icon: ListEnd, onClick: () => queueActions.add(book) },
    '-',
    ...lists.slice(0, 6).map((l) => ({ label: `Add to “${l.name}”${l.ids.includes(book.id) ? ' ✓' : ''}`, icon: ListMusic, disabled: l.ids.includes(book.id), onClick: () => playlistActions.add(l.id, book.id) })),
    { label: 'New playlist…', icon: Plus, onClick: () => onNewPlaylist(book.id) },
    ...(extra.length ? ['-', ...extra] : []),
  ];
}

export function NewPlaylistModal({ open, seedBookId, onClose, onCreated }) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  const create = () => {
    const id = playlistActions.create(name, seedBookId ? [seedBookId] : []);
    onClose();
    onCreated?.(id);
  };
  return (
    <Modal open={open} onClose={onClose} title="New playlist" size="sm"
      footer={<><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={create}>Create</button></>}>
      <Field label="Name">
        <input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Evening listening"
          onKeyDown={(e) => e.key === 'Enter' && create()} />
      </Field>
    </Modal>
  );
}

// ─── Albums ───────────────────────────────────────────────────────────────────
export function AlbumGrid({ books, playingId, playing, onPlay, onGenerate, onDelete, onNewPlaylist }) {
  const { lists } = usePlaylists();
  if (!books.length) return <EmptyState icon={Headphones} title="Turn a document into an audiobook." description="Generated audiobooks appear here as albums and remember where you stopped." action="Generate audio" onAction={onGenerate} />;
  const ready = books.filter((b) => b.status === 'ready');
  return (
    <div>
      {ready.length > 1 && (
        <div className="pl-actions" style={{ marginTop: 0, marginBottom: 16 }}>
          <button className="primary-button" onClick={() => onPlay(queueActions.playAll(ready))}><Play size={14} fill="currentColor" /> Play all</button>
          <button className="secondary-button" onClick={() => onPlay(queueActions.playAll(ready, { shuffle: true }))}><Shuffle size={14} /> Shuffle</button>
        </div>
      )}
      <div className="album-grid">
        {books.map((b) => {
          const isNow = b.id === playingId;
          return (
            <div key={b.id} className="album-card">
              <div className="art-wrap">
                <AlbumArt title={b.title} kicker={`${b.tone} narration`} color={b.color} playing={isNow && playing} className="hoverable" />
                {b.status === 'ready' && <button className="play-fab" onClick={() => onPlay(b.id)} aria-label={`Play ${b.title}`}><Play size={18} fill="currentColor" /></button>}
              </div>
              <div className="meta">
                <div className="meta-row">
                  <div><strong title={b.title}>{b.title}</strong><small>{b.tone} · {formatDuration(b.duration_seconds)} · {timeAgo(b.created_at)}</small></div>
                  <Menu label={`Options for ${b.title}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>}
                    items={albumMenuItems(b, {
                      lists, onNewPlaylist, onPlay,
                      extra: [
                        { label: 'Download script', icon: Download, onClick: () => onDelete.download(b) },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete.remove(b) },
                      ],
                    })} />
                </div>
                {b.status === 'ready' ? <ProgressBar value={b.progress} thin /> : <span className="status processing"><Loader2 size={12} className="spin" /> {b.status}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Playlists ────────────────────────────────────────────────────────────────
export function PlaylistsView({ books, playingId, playing, onPlay, onNewPlaylist, openId, setOpenId }) {
  const { lists } = usePlaylists();
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const resolve = (l) => l.ids.map((id) => byId.get(id)).filter(Boolean);
  const open = lists.find((l) => l.id === openId);
  const [renaming, setRenaming] = useState(null);

  if (open) {
    const items = resolve(open).filter((b) => b.status === 'ready');
    const total = items.reduce((t, b) => t + (b.duration_seconds || 0), 0);
    const commitName = (v) => { playlistActions.rename(open.id, v); setRenaming(null); };
    return (
      <div>
        <button className="text-button pl-back" onClick={() => setOpenId(null)}><ArrowLeft size={13} /> All playlists</button>
        <div className="pl-detail-head">
          <PlaylistArt name={open.name} books={items} size="lg" playing={items.some((b) => b.id === playingId) && playing} />
          <div>
            <div className="eyebrow">PLAYLIST</div>
            {renaming === open.id
              ? <input className="pl-name-input" autoFocus defaultValue={open.name} maxLength={60} onBlur={(e) => commitName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
              : <h2>{open.name}</h2>}
            <small className="muted">{items.length} {items.length === 1 ? 'album' : 'albums'} · {formatDuration(total)}</small>
            <div className="pl-actions">
              <button className="primary-button" disabled={!items.length} onClick={() => onPlay(queueActions.playAll(items))}><Play size={14} fill="currentColor" /> Play</button>
              <button className="secondary-button" disabled={!items.length} onClick={() => onPlay(queueActions.playAll(items, { shuffle: true }))}><Shuffle size={14} /> Shuffle</button>
              <button className="secondary-button" disabled={!items.length} onClick={() => queueActions.add(items)}><ListPlus size={14} /> Add to queue</button>
              <button className="secondary-button" onClick={() => setRenaming(open.id)}><Pencil size={14} /> Rename</button>
              <button className="secondary-button" onClick={() => { playlistActions.remove(open.id); setOpenId(null); }}><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="q-empty"><strong>No albums in this playlist yet</strong>Use “Add to playlist” in an album’s ⋯ menu on the Albums tab.</div>
        ) : (
          <div className="q-list">
            {items.map((b, i) => (
              <div key={b.id} className={`q-row ${b.id === playingId ? 'current' : ''}`}>
                <span className="q-dur" style={{ width: 20, textAlign: 'center' }}>{i + 1}</span>
                <button className="q-main" onClick={() => onPlay(queueActions.playAll(items.slice(i)))}>
                  <span className="q-art"><AlbumArt title={b.title} color={b.color} size="sm" playing={b.id === playingId && playing} bare /></span>
                  <span><strong>{b.title}</strong><small>{b.tone} narration</small></span>
                </button>
                <span className="q-dur">{formatDuration(b.duration_seconds)}</span>
                <Menu label={`Options for ${b.title}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>} items={[
                  { label: 'Play next', icon: ListStart, onClick: () => queueActions.add(b, { next: true }) },
                  { label: 'Add to queue', icon: ListEnd, onClick: () => queueActions.add(b) },
                  { label: 'Move up', icon: ArrowUp, disabled: i === 0, onClick: () => playlistActions.move(open.id, i, i - 1) },
                  { label: 'Move down', icon: ArrowDown, disabled: i === items.length - 1, onClick: () => playlistActions.move(open.id, i, i + 1) },
                  '-',
                  { label: 'Remove from playlist', icon: Trash2, danger: true, onClick: () => playlistActions.removeItem(open.id, b.id) },
                ]} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="pl-actions" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="primary-button" onClick={() => onNewPlaylist(null)}><Plus size={14} /> New playlist</button>
      </div>
      {lists.length === 0 ? (
        <EmptyState icon={ListMusic} title="Make your first playlist" description="Group audiobooks into playlists — play them in order, shuffle them, or send them to the queue." action="New playlist" onAction={() => onNewPlaylist(null)} />
      ) : (
        <div className="album-grid">
          {lists.map((l) => {
            const items = resolve(l);
            const isNow = items.some((b) => b.id === playingId);
            return (
              <div key={l.id} className="album-card">
                <div className="art-wrap">
                  <PlaylistArt name={l.name} books={items} playing={isNow && playing} className="hoverable" />
                  <button className="play-fab" disabled={!items.length} onClick={() => onPlay(queueActions.playAll(items.filter((b) => b.status === 'ready')))} aria-label={`Play ${l.name}`}><Play size={18} fill="currentColor" /></button>
                </div>
                <div className="meta">
                  <div className="meta-row">
                    <button style={{ textAlign: 'left', flex: 1, minWidth: 0 }} onClick={() => setOpenId(l.id)}>
                      <strong title={l.name}>{l.name}</strong><small>{items.length} {items.length === 1 ? 'album' : 'albums'}</small>
                    </button>
                    <Menu label={`Options for ${l.name}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>} items={[
                      { label: 'Open', icon: ListMusic, onClick: () => setOpenId(l.id) },
                      { label: 'Add to queue', icon: ListEnd, disabled: !items.length, onClick: () => queueActions.add(items) },
                      '-',
                      { label: 'Delete playlist', icon: Trash2, danger: true, onClick: () => playlistActions.remove(l.id) },
                    ]} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
