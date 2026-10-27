// Translate passages in batches through the API, remembering results for the session.
import { api } from '../api/client';

const memo = new Map();
const keyOf = (source, target, text) => `${source}>${target}|${text}`;
const MAX_ITEMS = 14;
const MAX_CHARS = 3500;

/**
 * Translate `texts` into `target`. Resolves with `{ out, note }`; an entry of `out` is null when it could not be translated
 * (e.g. the free daily allowance ran out) so callers can keep the original there. `onProgress(done, total)` fires per batch.
 */
export async function translateTexts(texts, target, source = 'en', { signal, onProgress } = {}) {
  const out = texts.map((t) => (t && t.trim() ? memo.get(keyOf(source, target, t)) ?? null : t));
  const todo = out.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const total = todo.length;
  let done = 0;
  let note = null;
  onProgress?.(0, total);

  // cut into batches, then translate up to 3 at once (the sequential version waited a full round-trip per batch)
  const batches = [];
  for (let at = 0; at < todo.length;) {
    const batch = [];
    let chars = 0;
    while (at < todo.length && batch.length < MAX_ITEMS && (batch.length === 0 || chars + texts[todo[at]].length <= MAX_CHARS)) {
      chars += texts[todo[at]].length;
      batch.push(todo[at]);
      at += 1;
    }
    batches.push(batch);
  }
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !signal?.aborted) {
      const batch = batches[next]; next += 1;
      const res = await api.ai.translate(batch.map((i) => texts[i]), target, source);
      if (signal?.aborted) return;
      batch.forEach((i, k) => {
        const t = res.translations[k];
        if (t) { out[i] = t; memo.set(keyOf(source, target, texts[i]), t); }
      });
      note = res.note || note;
      done += batch.length;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  return { out, note };
}
