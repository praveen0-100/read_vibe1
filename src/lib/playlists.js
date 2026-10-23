// User playlists of albums (audiobooks). Stored on this device; only ids are kept, so titles stay current.
import { createStore } from './localStore';

const store = createStore('readvibe.playlists.v1', { lists: [] });

export const usePlaylists = store.use;

const update = (id, fn) => store.set((s) => ({ ...s, lists: s.lists.map((l) => (l.id === id ? fn(l) : l)) }));

export const playlistActions = {
  create(name, ids = []) {
    const id = `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    store.set((s) => ({ ...s, lists: [{ id, name: name.trim() || 'New playlist', ids: [...new Set(ids)], created: Date.now() }, ...s.lists] }));
    return id;
  },
  rename(id, name) { if (name.trim()) update(id, (l) => ({ ...l, name: name.trim() })); },
  remove(id) { store.set((s) => ({ ...s, lists: s.lists.filter((l) => l.id !== id) })); },
  add(id, bookIds) { update(id, (l) => ({ ...l, ids: [...new Set([...l.ids, ...[].concat(bookIds)])] })); },
  removeItem(id, bookId) { update(id, (l) => ({ ...l, ids: l.ids.filter((x) => x !== bookId) })); },
  move(id, from, to) {
    update(id, (l) => {
      if (to < 0 || to >= l.ids.length) return l;
      const ids = [...l.ids];
      const [it] = ids.splice(from, 1);
      ids.splice(to, 0, it);
      return { ...l, ids };
    });
  },
  /** Remove audiobooks that were deleted. */
  prune(valid) {
    store.set((s) => (s.lists.every((l) => l.ids.every((i) => valid.has(i))) ? s
      : { ...s, lists: s.lists.map((l) => ({ ...l, ids: l.ids.filter((i) => valid.has(i)) })) }));
  },
};
