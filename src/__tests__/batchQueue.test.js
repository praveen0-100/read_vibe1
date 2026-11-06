import { describe, expect, it } from 'vitest';
import { bookKey, createOrderedQueuer } from '../lib/batchQueue';

describe('ordered batch queueing', () => {
  it('delivers in selection order even when books finish out of order', () => {
    const got = [];
    const q = createOrderedQueuer(3, (item) => got.push(item));
    q.ready(2, 'c');
    q.ready(0, 'a');
    expect(got).toEqual(['a']);          // b is still preparing, so c waits behind it
    q.ready(1, 'b');
    expect(got).toEqual(['a', 'b', 'c']);
  });

  it('skips a failed book without blocking the ones after it', () => {
    const got = [];
    const q = createOrderedQueuer(3, (item) => got.push(item));
    q.ready(0, 'a');
    q.fail(1);
    q.ready(2, 'c');
    expect(got).toEqual(['a', 'c']);
    expect(q.pending).toBe(0);
  });

  it('reports completion once with only the books that made it', () => {
    let done = null;
    let calls = 0;
    const q = createOrderedQueuer(2, () => {}, (ok) => { done = ok; calls += 1; });
    q.fail(0);
    q.ready(1, 'b');
    q.ready(1, 'b-again'); // a result can only be set once
    expect(done).toEqual(['b']);
    expect(calls).toBe(1);
  });

  it('handles an empty selection', () => {
    let done = null;
    createOrderedQueuer(0, () => {}, (ok) => { done = ok; });
    expect(done).toEqual([]);
  });

  it('matches catalogue titles to library books regardless of case and punctuation', () => {
    expect(bookKey('Alice’s Adventures in Wonderland', 'Lewis Carroll')).toBe(bookKey('ALICE\'S ADVENTURES IN WONDERLAND!', 'lewis  carroll'));
    expect(bookKey('A', 'B')).not.toBe(bookKey('A', 'C'));
  });
});
