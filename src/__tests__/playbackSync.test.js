import { beforeEach, describe, expect, it, vi } from 'vitest';

let q;
let pl;
let sync;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  q = await import('../lib/queue');
  pl = await import('../lib/playlists');
  sync = await import('../features/playback/playbackSync');
});
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const row = (id) => ({ id, title: id });
const empty = async () => ({ queue: {}, playlists: [], client_updated_at: 0 });

describe('playback sync', () => {
  it('adopts a newer server copy on start without echoing it back', async () => {
    const saveState = vi.fn();
    const state = async () => ({ queue: { queue: [row('x')], history: [], shuffle: true, repeat: 'all' }, playlists: [{ id: 'p', name: 'P', ids: ['x'] }], client_updated_at: 5000 });
    const stop = sync.startPlaybackSync({ state, saveState });
    await wait(20);
    expect(q.getQueue().queue.map((i) => i.id)).toEqual(['x']);
    expect(q.getQueue().shuffle).toBe(true);
    expect(pl.playlistStore.get().lists[0].name).toBe('P');
    expect(saveState).not.toHaveBeenCalled();
    stop();
  });

  it('pushes local changes debounced into one request with a timestamp', async () => {
    const saveState = vi.fn(async () => ({ applied: true }));
    const stop = sync.startPlaybackSync({ state: empty, saveState }, { debounce: 5, now: () => 7777 });
    await wait(10);
    q.queueActions.add({ id: 'a', title: 'A' });
    q.queueActions.add({ id: 'b', title: 'B' });
    await wait(40);
    expect(saveState).toHaveBeenCalledTimes(1);
    const body = saveState.mock.calls[0][0];
    expect(body.client_updated_at).toBe(7777);
    expect(body.queue.queue.map((i) => i.id)).toEqual(['a', 'b']);
    stop();
  });

  it('pushes the local copy on start when it is newer than the server', async () => {
    q.queueActions.add({ id: 'a', title: 'A' });
    localStorage.setItem('readvibe.sync.v1', JSON.stringify({ updatedAt: 9000 }));
    const saveState = vi.fn(async () => ({ applied: true }));
    const stop = sync.startPlaybackSync({ state: async () => ({ queue: {}, playlists: [], client_updated_at: 100 }), saveState });
    await wait(20);
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveState.mock.calls[0][0].client_updated_at).toBe(9000);
    stop();
  });

  it('adopts the server copy when a push is rejected as stale', async () => {
    const saveState = vi.fn(async () => ({ applied: false, queue: { queue: [row('server')], history: [] }, playlists: [], client_updated_at: 99999 }));
    const stop = sync.startPlaybackSync({ state: empty, saveState }, { debounce: 1, now: () => 10 });
    await wait(10);
    q.queueActions.add({ id: 'mine', title: 'M' });
    await wait(40);
    expect(q.getQueue().queue.map((i) => i.id)).toEqual(['server']);
    stop();
  });

  it('keeps working locally while the server is offline', async () => {
    const down = async () => { throw new Error('offline'); };
    const stop = sync.startPlaybackSync({ state: down, saveState: down }, { debounce: 1 });
    q.queueActions.add({ id: 'a', title: 'A' });
    await wait(30);
    expect(q.getQueue().queue).toHaveLength(1);
    stop();
  });
});
