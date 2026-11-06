// Central playback state: which audiobook is loaded, where the full player should render, and whether it is playing.
// One player for the whole app (see PlaybackHost) — Library, Reader and Audio Studio all drive this store instead of
// instantiating their own players. Only the loaded book id survives a reload; a restored player never auto-plays.
import { createStore } from '../../lib/localStore';

const store = createStore('readvibe.playback.v1', { bookId: null, nonce: 0, autoplay: false, chapter: null, playing: false });
// A page load never resumes sound by itself.
store.set((s) => ({ ...s, autoplay: false, chapter: null, playing: false }));

export const usePlayback = store.use;
export const getPlayback = store.get;

/** Where the full player UI mounts (the Audio Studio's player tab). Not persisted. */
let slotEl = null;
const slotSubs = new Set();
export const setPlayerSlot = (el) => { if (el !== slotEl) { slotEl = el; slotSubs.forEach((f) => f()); } };
export const getPlayerSlot = () => slotEl;
export const subscribeSlot = (f) => { slotSubs.add(f); return () => slotSubs.delete(f); };

export const playbackActions = {
  /** Load an audiobook (optionally from a chapter) and play it. */
  play(bookId, { autoplay = true, chapter = null } = {}) {
    if (!bookId) return;
    store.set((s) => ({ ...s, bookId, nonce: s.nonce + 1, autoplay, chapter }));
  },
  /** Load without playing (deep links, restore). */
  open(bookId) { this.play(bookId, { autoplay: false }); },
  /** Remember the album that is loaded (no reload). */
  remember(bookId) { if (bookId && store.get().bookId !== bookId) store.set((s) => ({ ...s, bookId })); },
  setPlaying(playing) { if (store.get().playing !== playing) store.set((s) => ({ ...s, playing })); },
  stop() { store.set((s) => ({ ...s, bookId: null, playing: false, autoplay: false, chapter: null })); },
  /** The loaded book was deleted. */
  dropIf(bookId) { if (store.get().bookId === bookId) this.stop(); },
};
