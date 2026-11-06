import { beforeEach, describe, expect, it, vi } from 'vitest';

const book = (id, extra = {}) => ({
  id, title: `Book ${id}`, tone: 'Regular', color: 'coral', document_id: `doc_${id}`, duration_seconds: 600,
  chapters: [{ index: 0, title: 'Intro', seconds: 100 }, { index: 1, title: 'Middle', seconds: 200 }, { index: 2, title: 'End', seconds: 300 }], ...extra,
});

let q;
let pl;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  q = await import('../lib/queue');
  pl = await import('../lib/playlists');
});

const ids = () => q.getQueue().queue.map(q.keyOf);

describe('play queue', () => {
  it('add appends and play-next inserts at the front', () => {
    q.queueActions.add(book('a'));
    q.queueActions.add(book('b'));
    q.queueActions.add(book('c'), { next: true });
    expect(ids()).toEqual(['c', 'a', 'b']);
  });

  it('re-adding a book moves it instead of duplicating it', () => {
    q.queueActions.add([book('a'), book('b')]);
    q.queueActions.add(book('a'));
    expect(ids()).toEqual(['b', 'a']);
  });

  it('adds exactly the chosen chapter, carrying source and artifact ids', () => {
    q.queueActions.addChapter(book('a'), 1);
    const [row] = q.getQueue().queue;
    expect(row).toMatchObject({ key: 'a#1', chapter: 1, mediaType: 'chapter', subtitle: 'Middle', sourceId: 'doc_a', artifactId: 'a', duration_seconds: 200 });
  });

  it('never duplicates chapters: a whole book replaces its queued chapters and covers later chapter adds', () => {
    q.queueActions.addChapter(book('a'), 0);
    q.queueActions.addChapter(book('a'), 2);
    q.queueActions.add(book('a'));
    expect(ids()).toEqual(['a']);
    q.queueActions.addChapter(book('a'), 1);
    expect(ids()).toEqual(['a']);
  });

  it('removing a queue item leaves playlists (and so the source) untouched', () => {
    const list = pl.playlistActions.create('Mine', ['a']);
    q.queueActions.add(book('a'));
    q.queueActions.remove('a');
    expect(ids()).toEqual([]);
    expect(pl.playlistStore.get().lists.find((l) => l.id === list).ids).toEqual(['a']);
  });

  it('reorders and survives a reload', async () => {
    q.queueActions.add([book('a'), book('b'), book('c')]);
    q.queueActions.move(2, 0);
    expect(ids()).toEqual(['c', 'a', 'b']);
    vi.resetModules();
    const again = await import('../lib/queue');
    expect(again.getQueue().queue.map(again.keyOf)).toEqual(['c', 'a', 'b']);
  });

  it('advances to the next item automatically, starting a chapter entry at its chapter', () => {
    q.queueActions.addChapter(book('b'), 2);
    q.queueActions.add(book('c'));
    expect(q.queueActions.advanceItem(book('a'), { auto: true })).toMatchObject({ id: 'b', chapter: 2 });
    expect(q.queueActions.advance(book('b'), { auto: true })).toBe('c');
    expect(q.queueActions.advance(book('c'), { auto: true })).toBeNull();
  });

  it('repeat one replays the current item; a manual next always moves on', () => {
    q.queueActions.cycleRepeat(); // all
    q.queueActions.cycleRepeat(); // one
    expect(q.getQueue().repeat).toBe('one');
    q.queueActions.add(book('b'));
    expect(q.queueActions.advance(book('a'), { auto: true })).toBe('a');
    expect(q.queueActions.advance(book('a'), { auto: false })).toBe('b');
  });

  it('repeat all restarts from what was played once the queue runs out', () => {
    q.queueActions.cycleRepeat(); // all
    q.queueActions.add(book('b'));
    expect(q.queueActions.advance(book('a'), { auto: true })).toBe('b');
    expect(q.queueActions.advance(book('b'), { auto: true })).toBe('a');
  });

  it('previous steps back and returns the current item to the front of the queue', () => {
    q.queueActions.add(book('b'));
    q.queueActions.advance(book('a'));
    expect(q.queueActions.previous(book('b'))).toBe('a');
    expect(ids()).toEqual(['b']);
  });

  it('clear empties pending items; prune drops deleted audiobooks', () => {
    q.queueActions.add([book('a'), book('b')]);
    q.queueActions.prune(new Set(['a']));
    expect(ids()).toEqual(['a']);
    q.queueActions.clear();
    expect(ids()).toEqual([]);
  });

  it('shuffle keeps the same items', () => {
    q.queueActions.add([book('a'), book('b'), book('c'), book('d')]);
    q.queueActions.shuffleUpcoming();
    expect([...ids()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('playlists', () => {
  it('creates, de-duplicates, reorders and prunes', () => {
    const id = pl.playlistActions.create('  Study  ', ['a', 'a', 'b']);
    pl.playlistActions.add(id, ['c', 'b']);
    pl.playlistActions.move(id, 2, 0);
    const list = () => pl.playlistStore.get().lists.find((l) => l.id === id);
    expect(list().name).toBe('Study');
    expect(list().ids).toEqual(['c', 'a', 'b']);
    pl.playlistActions.prune(new Set(['a', 'b']));
    expect(list().ids).toEqual(['a', 'b']);
  });

  it('changing one playlist does not alter another that holds the same item', () => {
    const one = pl.playlistActions.create('One', ['a']);
    const two = pl.playlistActions.create('Two', ['a']);
    pl.playlistActions.removeItem(one, 'a');
    expect(pl.playlistStore.get().lists.find((l) => l.id === two).ids).toEqual(['a']);
  });
});

describe('current album', () => {
  it('removeWhole drops only the whole-book entry of the loaded album, keeping its queued chapters', () => {
    q.queueActions.add([book('a'), book('b')]);
    q.queueActions.addChapter(book('c'), 1);
    q.queueActions.removeWhole('a');
    expect(ids()).toEqual(['b', 'c#1']);
    q.queueActions.removeWhole('c'); // c only has a chapter entry: untouched
    expect(ids()).toEqual(['b', 'c#1']);
  });
});
