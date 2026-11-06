// Several books are prepared in parallel (import + audiobook generation take different times), but they must join the queue in the
// order the listener chose them — like tracks of a playlist — not in the order they happen to finish. This delivers results in
// selection order: a slow book holds back the later ones, and a failed book is skipped without blocking anything.

export function createOrderedQueuer(total, deliver, onDone) {
  const slots = Array(total).fill(undefined); // undefined = still preparing, null = failed, anything else = ready
  let next = 0;
  let finished = false;
  const flush = () => {
    while (next < total && slots[next] !== undefined) {
      if (slots[next]) deliver(slots[next], next);
      next += 1;
    }
    if (!finished && next >= total) { finished = true; onDone?.(slots.filter(Boolean)); }
  };
  if (total === 0) flush();
  return {
    ready(index, item) { if (slots[index] === undefined) { slots[index] = item; flush(); } },
    fail(index) { if (slots[index] === undefined) { slots[index] = null; flush(); } },
    get delivered() { return next; },
    get pending() { return slots.filter((s) => s === undefined).length; },
  };
}

/** Normalised key for matching a catalogue title against the library (case, punctuation and spacing ignored). */
export const bookKey = (title = '', author = '') => `${title}|${author}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').replace(/\s+/g, ' ').replace(/ ?\| ?/, '|').trim();
