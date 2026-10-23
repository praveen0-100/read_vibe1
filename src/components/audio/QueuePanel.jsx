// Up-next queue: reorder by drag or menu, shuffle, repeat, history, and quick-add from the library.
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, History, ListPlus, ListX, Play, Plus, Repeat, Repeat1, Shuffle, Trash2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import { queueActions, useQueue } from '../../lib/queue';
import { Menu } from '../ui';
import AlbumArt from './AlbumArt';

const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

export default function QueuePanel({ current, playing, library = [], onPlay, compact = false }) {
  const { queue, history, shuffle, repeat } = useQueue();
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const remaining = queue.reduce((t, q) => t + (q.duration_seconds || 0), 0);
  const queued = new Set([...queue.map((q) => q.id), current?.id]);
  const suggestions = library.filter((b) => b.status === 'ready' && !queued.has(b.id));
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;

  const drop = (to) => {
    if (drag != null && drag !== to) queueActions.move(drag, to);
    setDrag(null); setOver(null);
  };

  return (
    <div className="queue-panel">
      <div className="queue-head">
        <h3>Up next</h3>
        {queue.length > 0 && <span className="sub">{queue.length} {queue.length === 1 ? 'album' : 'albums'} · {formatDuration(remaining)}</span>}
        <button className={`q-toggle ${shuffle ? 'on' : ''}`} onClick={queueActions.toggleShuffle} aria-pressed={shuffle} title="Play the queue in random order"><Shuffle size={13} /> Shuffle</button>
        <button className={`q-toggle ${repeat !== 'off' ? 'on' : ''}`} onClick={queueActions.cycleRepeat} title="Cycle repeat mode"><RepeatIcon size={13} /> {REPEAT_LABEL[repeat]}</button>
        {queue.length > 1 && <button className="q-toggle" onClick={queueActions.shuffleUpcoming} title="Reorder the queue randomly"><Shuffle size={13} /> Mix up</button>}
        {queue.length > 0 && <button className="q-toggle" onClick={queueActions.clear}><ListX size={13} /> Clear</button>}
      </div>

      {current && (
        <div className="q-section">
          <div className="eyebrow">NOW PLAYING</div>
          <div className="q-row current">
            <span className="grip" aria-hidden="true" />
            <div className="q-main">
              <span className="q-art"><AlbumArt title={current.title} color={current.color} size="sm" playing={playing} bare /></span>
              <span><strong>{current.title}</strong><small>{current.tone} narration</small></span>
            </div>
            <span className="q-dur">{formatDuration(current.duration_seconds)}</span>
          </div>
        </div>
      )}

      <div className="q-section">
        <div className="eyebrow">NEXT IN QUEUE</div>
        {queue.length === 0 ? (
          <div className="q-empty"><strong>Your queue is empty</strong>Add albums with “Add to queue” or pick some below{repeat === 'all' ? '. Repeat all will loop what you’ve played.' : '.'}</div>
        ) : (
          <div className="q-list" role="list">
            {queue.map((q, i) => (
              <div key={q.id} role="listitem" draggable onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDrop={() => drop(i)}
                className={`q-row ${drag === i ? 'dragging' : ''} ${over === i && drag != null && drag !== i ? 'over' : ''}`}>
                <span className="grip" aria-hidden="true"><GripVertical size={15} /></span>
                <button className="q-main" onClick={() => onPlay(q.id, { fromQueue: true })} aria-label={`Play ${q.title} now`}>
                  <span className="q-art"><AlbumArt title={q.title} color={q.color} size="sm" bare /></span>
                  <span><strong>{q.title}</strong><small>{q.tone} · {q.chapters || '—'} chapters</small></span>
                </button>
                <span className="q-dur">{formatDuration(q.duration_seconds)}</span>
                <Menu label={`Options for ${q.title}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>} items={[
                  { label: 'Play now', icon: Play, onClick: () => onPlay(q.id, { fromQueue: true }) },
                  { label: 'Move up', icon: ArrowUp, disabled: i === 0, onClick: () => queueActions.move(i, i - 1) },
                  { label: 'Move down', icon: ArrowDown, disabled: i === queue.length - 1, onClick: () => queueActions.move(i, i + 1) },
                  '-',
                  { label: 'Remove from queue', icon: Trash2, danger: true, onClick: () => queueActions.removeAt(i) },
                ]} />
              </div>
            ))}
          </div>
        )}
      </div>

      {!compact && suggestions.length > 0 && (
        <div className="q-section">
          <div className="eyebrow">ADD FROM YOUR LIBRARY</div>
          <div className="q-suggest">
            {suggestions.map((b) => (
              <div key={b.id}>
                <AlbumArt title={b.title} color={b.color} size="md" bare />
                <button className="add-chip" onClick={() => queueActions.add(b)} aria-label={`Add ${b.title} to queue`} title="Add to queue"><Plus size={15} /></button>
                <strong>{b.title}</strong>
              </div>
            ))}
          </div>
          <button className="text-button" onClick={() => queueActions.add(suggestions)}><ListPlus size={13} /> Add all {suggestions.length}</button>
        </div>
      )}

      {!compact && history.length > 0 && (
        <div className="q-section">
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><History size={12} /> RECENTLY PLAYED
            <button className="text-button" style={{ marginLeft: 'auto' }} onClick={queueActions.clearHistory}>Clear</button></div>
          <div className="q-list">
            {history.slice(0, 8).map((h) => (
              <div key={h.id} className="q-row">
                <span className="grip" aria-hidden="true" />
                <button className="q-main" onClick={() => onPlay(h.id)}>
                  <span className="q-art"><AlbumArt title={h.title} color={h.color} size="sm" bare /></span>
                  <span><strong>{h.title}</strong><small>{h.tone} narration</small></span>
                </button>
                <button className="icon-ghost sm" onClick={() => queueActions.add(h)} aria-label={`Add ${h.title} to queue`} title="Add to queue"><Plus size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
