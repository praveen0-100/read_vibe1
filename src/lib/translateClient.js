// Translate passages in batches through the API, remembering results for the session.
//
// Unlimited by design: the server translates first (AI model when configured, otherwise the free services, cached on disk). Anything it
// cannot do — a spent daily allowance, a blocked server address, a sleeping server — is finished here, in the browser, straight against
// Google's public translate endpoint (then MyMemory). Those calls come from the reader's own device, so there is no shared quota to run out.
import { api } from '../api/client';

const memo = new Map();
const keyOf = (source, target, text) => `${source}>${target}|${text}`;
const MAX_ITEMS = 14;
const MAX_CHARS = 3500;
const LOCAL_CHUNK = 1800;
const STORE = 'rv.tr.v1';
const STORE_MAX = 1500; // entries kept between visits

// results survive a reload, so a chapter is only ever translated once per device
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '[]');
  saved.forEach(([k, v]) => memo.set(k, v));
} catch { /* storage unavailable or corrupt: start empty */ }
let saveTimer = 0;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const rows = [...memo.entries()].slice(-STORE_MAX);
      localStorage.setItem(STORE, JSON.stringify(rows));
    } catch { /* full or blocked: the in-memory copy still works */ }
  }, 800);
};

const GOOGLE_CODES = { zh: 'zh-CN', he: 'iw', jv: 'jw' };
const gcode = (c) => GOOGLE_CODES[c] || c;

/** Cut text into pieces of at most `size` characters at a sentence end or a space. */
export function splitText(text, size = LOCAL_CHUNK) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = Math.max(rest.lastIndexOf('. ', size), rest.lastIndexOf('? ', size), rest.lastIndexOf('! ', size), rest.lastIndexOf('। ', size));
    if (cut < size / 3) cut = rest.lastIndexOf(' ', size);
    if (cut < 1) cut = size - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function viaGoogle(text, source, target, signal) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${gcode(source)}&tl=${gcode(target)}&dt=t`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: `q=${encodeURIComponent(text)}`, signal,
  });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  return (data[0] || []).map((seg) => seg?.[0] || '').join('');
}

async function viaMyMemory(text, source, target, signal) {
  const out = [];
  for (const piece of splitText(text, 450)) {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${source}|${target}`, { signal });
    const data = await res.json();
    const t = data?.responseData?.translatedText;
    if (!res.ok || data.quotaFinished || !t || /ALL AVAILABLE FREE TRANSLATIONS/i.test(t)) throw new Error('MyMemory unavailable');
    out.push(t);
  }
  return out.join(' ');
}

const decode = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };

/** One passage translated on this device. Returns null when no service could do it. */
export async function translateHere(text, target, source = 'en', signal) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean || source === target) return clean;
  const done = [];
  for (const piece of splitText(clean)) {
    let got = null;
    for (const provider of [viaGoogle, viaMyMemory]) {
      for (let attempt = 0; attempt < 2 && got == null && !signal?.aborted; attempt += 1) {
        try {
          const t = decode(await provider(piece, source, target, signal)).trim();
          if (t && (t.toLowerCase() !== piece.toLowerCase() || target === 'en')) got = t;
          else break; // came back untranslated: another service may do better
        } catch (err) {
          if (signal?.aborted || err?.name === 'AbortError') return null;
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
      }
      if (got != null) break;
    }
    if (got == null) return null;
    done.push(got);
  }
  return done.join(' ');
}

/** Fill the gaps (`out[i] === null`) from this device, four passages at a time. */
async function finishLocally(texts, out, idx, target, source, signal, tick) {
  let next = 0;
  const worker = async () => {
    while (next < idx.length && !signal?.aborted) {
      const i = idx[next]; next += 1;
      const t = await translateHere(texts[i], target, source, signal);
      if (t) { out[i] = t; memo.set(keyOf(source, target, texts[i]), t); }
      tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, idx.length) }, worker));
  persist();
}

/**
 * Translate `texts` into `target`. Resolves with `{ out, note }`; an entry of `out` is null only when neither the server nor this
 * device could translate it, so callers can keep the original there. `onProgress(done, total)` fires as passages complete.
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
  const gaps = [];
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !signal?.aborted) {
      const batch = batches[next]; next += 1;
      let res = null;
      try { res = await api.ai.translate(batch.map((i) => texts[i]), target, source); } catch { /* server asleep or erroring: this device takes over */ }
      if (signal?.aborted) return;
      batch.forEach((i, k) => {
        const t = res?.translations?.[k];
        if (t) { out[i] = t; memo.set(keyOf(source, target, texts[i]), t); done += 1; } else gaps.push(i);
      });
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  if (signal?.aborted) return { out, note };

  if (gaps.length) {
    await finishLocally(texts, out, gaps, target, source, signal, () => { done += 1; onProgress?.(Math.min(done, total), total); });
    const still = gaps.filter((i) => out[i] === null).length;
    if (still) note = `${still} passage${still === 1 ? '' : 's'} could not be translated right now — check your connection and try again.`;
  }
  persist();
  return { out, note };
}
