// Keeps the play queue and playlists in step with the account, so they survive a new browser or device.
// Local storage stays the source of truth while offline; the server copy is reconciled last-writer-wins by timestamp.
import { queueStore } from '../../lib/queue';
import { playlistStore } from '../../lib/playlists';

const META_KEY = 'readvibe.sync.v1';
const readMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) || { updatedAt: 0 }; } catch { return { updatedAt: 0 }; } };
const writeMeta = (m) => { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* private mode */ } };

export const snapshot = () => {
  const { queue, history, shuffle, repeat } = queueStore.get();
  return { queue: { queue, history, shuffle, repeat }, playlists: playlistStore.get().lists };
};

const applyRemote = (remote) => {
  const q = remote.queue || {};
  queueStore.set((s) => ({ ...s, queue: q.queue || [], history: q.history || [], shuffle: !!q.shuffle, repeat: q.repeat || 'off' }));
  playlistStore.set((s) => ({ ...s, lists: remote.playlists || [] }));
};

/**
 * Start syncing. `api` = { state(), saveState(body) }. Returns a stop function.
 * 1. pull once: the newer side wins; 2. push (debounced) whenever the queue or a playlist changes locally.
 */
export function startPlaybackSync(api, { debounce = 1200, now = Date.now } = {}) {
  let applying = false;
  let timer = null;
  let stopped = false;

  const push = async () => {
    if (stopped) return;
    const meta = readMeta();
    try {
      const res = await api.saveState({ ...snapshot(), client_updated_at: meta.updatedAt });
      if (res && res.applied === false) {          // another device wrote later: adopt its copy
        applying = true; applyRemote(res); applying = false;
        writeMeta({ updatedAt: res.client_updated_at });
      }
    } catch { /* offline: the next change (or reload) retries */ }
  };

  const onLocalChange = () => {
    if (applying || stopped) return;
    writeMeta({ updatedAt: now() });
    clearTimeout(timer);
    timer = setTimeout(push, debounce);
  };
  const unsubs = [queueStore.subscribe(onLocalChange), playlistStore.subscribe(onLocalChange)];

  (async () => {
    try {
      const remote = await api.state();
      if (stopped) return;
      const local = readMeta().updatedAt;
      if (remote.client_updated_at > local) {
        applying = true; applyRemote(remote); applying = false;
        writeMeta({ updatedAt: remote.client_updated_at });
      } else if (local > remote.client_updated_at) {
        push();
      }
    } catch { /* offline */ }
  })();

  return () => { stopped = true; clearTimeout(timer); unsubs.forEach((u) => u()); };
}
