// Play queue — "Up next", history, shuffle and repeat, like a music / podcast player.
// Items are albums (audiobooks); the queue never holds the album that is currently playing.
import { createStore } from './localStore';

const HISTORY_LIMIT = 40;
const store = createStore('readvibe.queue.v1', { queue: [], history: [], shuffle: false, repeat: 'off' });

export const useQueue = store.use;
export const getQueue = store.get;
export const queueStore = store;

/** Identity of a queue entry: a whole book is its id, a single chapter is `id#chapter`. */
export const keyOf = (x) => x.key || x.id;

/**
 * The few fields a queue row needs; `sections` are the book's chapters, shown when its row is expanded.
 * `mediaType` / `sourceId` / `artifactId` follow the Source -> Artifact model (the audiobook is the artifact, the document its source).
 * Pass `{ chapter }` to make a single-chapter entry that starts playback at that chapter.
 */
export const slim = (b, { chapter = null } = {}) => {
  const sections = Array.isArray(b.chapters) ? b.chapters.map((c, i) => ({ index: c.index ?? i, title: c.title, seconds: c.seconds || 0 })) : (b.sections || []);
  const count = Array.isArray(b.chapters) ? b.chapters.length : (b.chapter_count ?? b.chapters ?? 0);
  const row = {
    id: b.id, title: b.title, tone: b.tone, color: b.color,
    mediaType: chapter != null ? 'chapter' : (b.mediaType || 'audiobook'),
    sourceId: b.document_id ?? b.sourceId ?? null, artifactId: b.id,
    cover: b.document_has_cover ? b.document_id : (b.cover ?? null),
    duration_seconds: b.duration_seconds || 0, chapters: count, sections,
  };
  if (chapter != null) {
    const sec = sections.find((x) => x.index === chapter);
    Object.assign(row, { key: `${b.id}#${chapter}`, chapter, subtitle: sec?.title || `Chapter ${chapter + 1}`, duration_seconds: sec?.seconds || 0 });
  } else if (b.chapter != null && b.key) {
    Object.assign(row, { key: b.key, chapter: b.chapter, subtitle: b.subtitle, mediaType: 'chapter' });
  }
  return row;
};

const asList = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean).map((i) => slim(i));
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export const queueActions = {
  /** Append (or, with `next`, insert at the front). Re-adding moves an album instead of duplicating it. */
  add(items, { next = false } = {}) {
    const add = asList(items);
    store.set((s) => {
      const keys = new Set(add.map(keyOf));
      const wholeBooks = new Set(add.filter((i) => i.chapter == null).map((i) => i.id));
      // a whole book replaces any of its queued chapters; a chapter of an already-queued whole book is already covered
      const covered = new Set(s.queue.filter((q) => q.chapter == null).map((q) => q.id));
      const fresh = add.filter((i) => i.chapter == null || !covered.has(i.id) || wholeBooks.has(i.id));
      const rest = s.queue.filter((q) => !keys.has(keyOf(q)) && !(q.chapter != null && wholeBooks.has(q.id)));
      return { ...s, queue: next ? [...fresh, ...rest] : [...rest, ...fresh] };
    });
  },
  /** Queue exactly one chapter of a book. */
  addChapter(book, chapter, opts) { this.add({ ...slim(book, { chapter }) }, opts); },
  /** Replace the queue with `items` (optionally shuffled) and return the first id to play. */
  playAll(items, { shuffle = false, skip } = {}) {
    let list = asList(items);
    if (shuffle) list = shuffled(list);
    const [first, ...rest] = list;
    store.set((s) => ({ ...s, queue: rest, history: skip ? s.history : [] }));
    return first?.id ?? null;
  },
  removeAt(i) { store.set((s) => ({ ...s, queue: s.queue.filter((_, k) => k !== i) })); },
  /** Remove by entry key (a chapter entry) or, for a book id, every entry of that book. */
  remove(idOrKey) { store.set((s) => ({ ...s, queue: s.queue.filter((q) => keyOf(q) !== idOrKey && q.id !== idOrKey) })); },
  /** Drop the whole-book entry for `id` (the album that is now loaded in the player); single-chapter entries of it stay. */
  removeWhole(id) { store.set((s) => (s.queue.some((q) => q.id === id && q.chapter == null) ? { ...s, queue: s.queue.filter((q) => !(q.id === id && q.chapter == null)) } : s)); },
  move(from, to) {
    store.set((s) => {
      if (to < 0 || to >= s.queue.length || from === to) return s;
      const q = [...s.queue];
      const [it] = q.splice(from, 1);
      q.splice(to, 0, it);
      return { ...s, queue: q };
    });
  },
  clear() { store.set((s) => ({ ...s, queue: [] })); },
  clearHistory() { store.set((s) => ({ ...s, history: [] })); },
  shuffleUpcoming() { store.set((s) => ({ ...s, queue: shuffled(s.queue) })); },
  toggleShuffle() { store.set((s) => ({ ...s, shuffle: !s.shuffle })); },
  cycleRepeat() { store.set((s) => ({ ...s, repeat: { off: 'all', all: 'one', one: 'off' }[s.repeat] })); },

  /**
   * The album to play after `current`, or null. `auto` = the album ended by itself
   * (repeat-one replays it; a manual "next" always moves on).
   */
  advance(current, opts) { return this.advanceItem(current, opts)?.id ?? null; },
  /** Like `advance` but returns the whole entry, so a chapter entry can start at its chapter. */
  advanceItem(current, { auto = false } = {}) {
    const s = store.get();
    if (auto && s.repeat === 'one' && current) return { id: current.id, chapter: null };
    let queue = s.queue;
    let history = current ? [slim(current), ...s.history.filter((h) => h.id !== current.id)].slice(0, HISTORY_LIMIT) : s.history;
    if (!queue.length && s.repeat === 'all') queue = [...history].reverse().filter((h) => h.id !== current?.id);
    if (!queue.length) { store.set({ ...s, history }); return null; }
    const i = s.shuffle ? Math.floor(Math.random() * queue.length) : 0;
    const next = queue[i];
    store.set({ ...s, queue: queue.filter((_, k) => k !== i), history });
    return next;
  },
  /** Step back to the previously played album (it returns to the front of the queue). */
  previous(current) {
    const s = store.get();
    const prev = s.history[0];
    if (!prev) return null;
    store.set({ ...s, history: s.history.slice(1), queue: current ? [slim(current), ...s.queue.filter((q) => q.id !== current.id)] : s.queue });
    return prev.id;
  },
  /** Drop albums that no longer exist (deleted audiobooks). */
  prune(validIds) {
    const ok = (x) => validIds.has(x.id);
    store.set((s) => (s.queue.every(ok) && s.history.every(ok) ? s : { ...s, queue: s.queue.filter(ok), history: s.history.filter(ok) }));
  },
};
