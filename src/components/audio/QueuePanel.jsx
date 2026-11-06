// Up-next queue: reorder by drag or menu, shuffle, repeat, history, and quick-add from the library.
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, History, ListPlus, ListX, Loader2, Play, Plus, Repeat, Repeat1, Shuffle, Trash2, Upload, WandSparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { formatDuration } from '../../lib/format';
import { keyOf, queueActions, slim, useQueue } from '../../lib/queue';
import { Menu } from '../ui';
import AlbumArt from './AlbumArt';

const REPEAT_LABEL = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };

/** A book's sections, numbered; picking one plays the book from there. */
function SectionList({ sections, onPick }) {
  return (
    <ol className="q-sections">
      {sections.map((s) => (
        <li key={s.index}>
          <button onClick={() => onPick(s)} title={`Play from “${s.title}”`}>
            <span className="qs-num">{s.index + 1}</span>
            <span className="qs-title">{s.title}</span>
            {s.seconds > 0 && <span className="q-dur">{formatDuration(s.seconds)}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function QueuePanel({ current, playing, library = [], onPlay, compact = false }) {
  const { queue, history, shuffle, repeat } = useQueue();
  const { notify, trackJob, setUploadOpen, dataVersion, refreshData } = useApp();
  // every readable book in the library, not just the ones that already have audio — "Add a book" must work for any of them
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion]);
  const [making, setMaking] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // queued items saved before sections existed fall back to the library copy of the book
  const sectionsOf = (q) => (q.sections?.length ? q.sections : slim(library.find((b) => b.id === q.id) || q).sections);
  const allOpen = queue.length > 0 && queue.every((q) => open.has(keyOf(q)));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(queue.map(keyOf)));
  const remaining = queue.reduce((t, q) => t + (q.duration_seconds || 0), 0);
  const queued = new Set([...queue.map((q) => q.id), current?.id]);
  const suggestions = library.filter((b) => b.status === 'ready' && !queued.has(b.id));
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;

  // books that have no audiobook yet: make one, and queue it automatically the moment it is ready
  const withAudio = new Set(library.map((b) => b.document_id));
  const needAudio = (docs.data || []).filter((d) => d.status === 'ready' && !withAudio.has(d.id));
  const makeAudio = async (doc) => {
    setMaking((s) => new Set(s).add(doc.id));
    try {
      const res = await api.audio.create({ document_id: doc.id, tone: 'Regular' });
      notify(`Making an audiobook of “${doc.title}” — it will join your queue when it’s ready`, 'info');
      trackJob(res.job_id, async (job) => {
        setMaking((s) => { const n = new Set(s); n.delete(doc.id); return n; });
        if (job.status !== 'completed') { notify(job.status === 'failed' ? `Couldn’t make the audiobook: ${job.error || 'it failed'}` : 'Audiobook cancelled', 'error'); return; }
        try { queueActions.add(await api.audio.get(res.audiobook.id)); notify(`“${doc.title}” is ready and added to your queue`); } catch (e) { notify(e.message, 'error'); }
        refreshData();
      });
    } catch (e) {
      setMaking((s) => { const n = new Set(s); n.delete(doc.id); return n; });
      notify(e.message, 'error');
    }
  };
  const addItems = [
    ...suggestions.map((b) => ({ label: b.title, icon: Plus, onClick: () => { queueActions.add(b); notify(`Added “${b.title}” to the queue`); } })),
    ...(suggestions.length > 1 ? [{ label: `Add all ${suggestions.length} audiobooks`, icon: ListPlus, onClick: () => { queueActions.add(suggestions); notify(`Added ${suggestions.length} audiobooks`); } }] : []),
    ...(suggestions.length && needAudio.length ? ['-'] : []),
    ...needAudio.map((d) => ({ label: making.has(d.id) ? `Making audio… ${d.title}` : `Make audiobook · ${d.title}`, icon: making.has(d.id) ? Loader2 : WandSparkles, disabled: making.has(d.id), onClick: () => makeAudio(d) })),
    '-',
    { label: 'Upload a new book…', icon: Upload, onClick: () => setUploadOpen(true) },
  ];

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
          <div className="q-item">
            <div className="q-row current">
              <span className="grip" aria-hidden="true" />
              <button className={`q-fold ${open.has(current.id) ? 'open' : ''}`} onClick={() => toggle(current.id)} disabled={!sectionsOf(current).length}
                aria-expanded={open.has(current.id)} aria-label={`${open.has(current.id) ? 'Collapse' : 'Expand'} sections of ${current.title}`}>
                <ChevronDown size={16} />
              </button>
              <div className="q-main">
                <span className="q-art"><AlbumArt title={current.title} color={current.color} cover={current.cover} size="sm" playing={playing} bare /></span>
                <span><strong>{current.title}</strong><small>{current.tone} narration</small></span>
              </div>
              <span className="q-dur">{formatDuration(current.duration_seconds)}</span>
            </div>
            {open.has(current.id) && <SectionList sections={sectionsOf(current)} onPick={(s) => onPlay(current.id, { chapter: s.index })} />}
          </div>
        </div>
      )}

      <div className="q-section">
        <div className="eyebrow q-eyebrow">NEXT IN QUEUE
          <Menu label="Add a book to the queue" align="right" trigger={<span className="q-toggle"><Plus size={13} /> Add a book</span>} items={addItems} />
          {queue.length > 0 && <button className="text-button" onClick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>}
        </div>
        {queue.length === 0 ? (
          <div className="q-empty"><strong>Your queue is empty</strong>Add albums with “Add to queue” or pick some below{repeat === 'all' ? '. Repeat all will loop what you’ve played.' : '.'}</div>
        ) : (
          <div className="q-list" role="list">
            {queue.map((q, i) => {
              const secs = sectionsOf(q);
              const qk = keyOf(q);
              const expanded = open.has(qk);
              return (
                <div key={qk} role="listitem" className="q-item">
                  <div draggable onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDrop={() => drop(i)}
                    className={`q-row ${drag === i ? 'dragging' : ''} ${over === i && drag != null && drag !== i ? 'over' : ''}`}>
                    <span className="grip" aria-hidden="true"><GripVertical size={15} /></span>
                    <button className={`q-fold ${expanded ? 'open' : ''}`} onClick={() => toggle(qk)} disabled={!secs.length || q.chapter != null}
                      aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} sections of ${q.title}`} title={expanded ? 'Hide sections' : 'Show sections'}>
                      <ChevronDown size={16} />
                    </button>
                    <button className="q-main" onClick={() => onPlay(q.id, { fromQueue: true, key: qk, chapter: q.chapter ?? null })} aria-label={`Play ${q.title} now`}>
                      <span className="q-art"><AlbumArt title={q.title} color={q.color} cover={q.cover} size="sm" bare /></span>
                      <span><strong>{q.chapter != null ? q.subtitle : q.title}</strong><small>{q.chapter != null ? `${q.title} · chapter ${q.chapter + 1}` : `${q.tone} · ${q.chapters || '—'} sections`}</small></span>
                    </button>
                    <span className="q-dur">{formatDuration(q.duration_seconds)}</span>
                    <Menu label={`Options for ${q.title}`} align="right" trigger={<span className="icon-ghost sm">⋯</span>} items={[
                      { label: 'Play now', icon: Play, onClick: () => onPlay(q.id, { fromQueue: true, key: qk, chapter: q.chapter ?? null }) },
                      { label: 'Move up', icon: ArrowUp, disabled: i === 0, onClick: () => queueActions.move(i, i - 1) },
                      { label: 'Move down', icon: ArrowDown, disabled: i === queue.length - 1, onClick: () => queueActions.move(i, i + 1) },
                      '-',
                      { label: 'Remove from queue', icon: Trash2, danger: true, onClick: () => queueActions.removeAt(i) },
                    ]} />
                  </div>
                  {expanded && <SectionList sections={secs} onPick={(s) => onPlay(q.id, { fromQueue: true, key: qk, chapter: s.index })} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!compact && suggestions.length > 0 && (
        <div className="q-section">
          <div className="eyebrow">ADD FROM YOUR LIBRARY</div>
          <div className="q-suggest">
            {suggestions.map((b) => (
              <div key={b.id}>
                <AlbumArt title={b.title} color={b.color} cover={b.document_has_cover ? b.document_id : null} size="md" bare />
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
                  <span className="q-art"><AlbumArt title={h.title} color={h.color} cover={h.cover} size="sm" bare /></span>
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
