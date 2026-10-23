// ─── Languages: Indian languages first, Southern languages at the very top ───────────────────────────────────
// Mirrors backend/app/services/languages.py (the server owns the voice catalogue; this is for instant, offline detection).

export const PRIORITY = ['ta', 'te', 'ml', 'kn', 'hi', 'mr', 'bn', 'gu', 'pa', 'or', 'ur', 'en'];

const SCRIPTS = {
  ta: /[஀-௿]/g,
  te: /[ఀ-౿]/g,
  ml: /[ഀ-ൿ]/g,
  kn: /[ಀ-೿]/g,
  deva: /[ऀ-ॿ]/g, // Hindi or Marathi
  bn: /[ঀ-৿]/g,
  gu: /[઀-૿]/g,
  pa: /[਀-੿]/g,
  or: /[଀-୿]/g,
  ur: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g,
  en: /[A-Za-zÀ-ɏ]/g,
};
const HI_WORDS = new Set(['है', 'और', 'में', 'का', 'को', 'से', 'नहीं', 'यह', 'था']);
const MR_WORDS = new Set(['आहे', 'आणि', 'होते', 'नाही', 'हे', 'मध्ये', 'की', 'त्या', 'आहेत']);

/** Language code of a text from its script. Latin script, or too little text, means English. */
export function detectLanguage(text, sample = 6000) {
  const t = (text || '').slice(0, sample);
  let best = 'en';
  let bestN = 0;
  let total = 0;
  for (const [code, re] of Object.entries(SCRIPTS)) {
    const n = (t.match(re) || []).length;
    total += n;
    if (n > bestN) { best = code; bestN = n; }
  }
  if (!total || best === 'en' || bestN / total < 0.2) return 'en';
  if (best === 'deva') {
    const words = t.match(/[ऀ-ॿ]+/g) || [];
    const hi = words.filter((w) => HI_WORDS.has(w)).length;
    const mr = words.filter((w) => MR_WORDS.has(w)).length;
    return mr > hi ? 'mr' : 'hi';
  }
  return best;
}

/** BCP-47 tag for the browser's speech engine. */
export const speechTag = (code) => ({ en: 'en-IN', ur: 'ur-IN' }[code] || `${code}-IN`);

/** Sentence-ending marks across scripts: . ! ? । ॥ ۔ ؟ — used when cutting text into speakable sentences. */
export const SENTENCE_RE = /[^.!?।॥۔؟]+[.!?।॥۔؟]+["”’)]*|[^.!?।॥۔؟]+$/g;

/** Split `text` into pieces of at most `max` characters, cutting at spaces (never inside a word or letter cluster). */
export function chunkAtSpaces(text, max = 230) {
  const out = [];
  let from = 0;
  while (from < text.length) {
    let to = Math.min(text.length, from + max);
    if (to < text.length) {
      const space = text.lastIndexOf(' ', to);
      if (space > from + max * 0.5) to = space + 1;
    }
    out.push([from, text.slice(from, to)]);
    from = to;
  }
  return out;
}

/** Light body-copy tuning per script: taller lines, no hyphenation or justification (neither suits these scripts). */
export const isIndic = (code) => !['en'].includes(code || 'en');
