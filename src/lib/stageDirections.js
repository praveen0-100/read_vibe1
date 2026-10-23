// ─── Stage directions are performed, not read ─────────────────────────────────────────────────────────────────
// A play, screenplay or annotated text has speaker labels ("willy [directly to biff]:"), directions
// ("[biff breaks from happy. willy, in fright, starts up the stairs. ]") and citations ("[3]"). None of that is words a
// narrator says. This module splits a paragraph into spans that are either SPOKEN (with the character and the feeling
// the direction asked for) or SILENT (shown dimmed in the transcript, skipped in the audio).
//
// Emotion names match backend/app/services/tts.PRESETS, which turns them into rate / pitch / volume.

/** First match wins. Order matters: specific feelings before general ones. */
const RULES = [
  ['whisper', /\b(whisper\w*|under (?:his|her|their) breath|hushed)\b/i],
  ['fright', /\b(fright\w*|afraid|terrif\w*|panic\w*|alarm\w*|scared|dread\w*)\b/i],
  ['angry', /\b(fur(?:y|ious)|anger|angry|outburst|shout\w*|yell\w*|scream\w*|rage|enrag\w*|vengeful|snap\w*|livid|roar\w*|explod\w*)\b/i],
  ['surprise', /\b(astonish\w*|surpris\w*|shock\w*|amaz\w*|incredul\w*|stunned|gasp\w*)\b/i],
  ['sad', /\b(sob\w*|cry\w*|weep\w*|tears?|broken|breaks down|dejected|sad(?:ly)?|despair\w*|mourn\w*|heartbroken|defeated)\b/i],
  ['sarcastic', /\b(sarcas\w*|bitter(?:ly)?|dry(?:ly)?|cold(?:ly)?|flat(?:ly)?|mock\w*|scorn\w*|sneer\w*|contempt\w*)\b/i],
  ['gentle', /\b(tender\w*|gentl\w*|lov(?:ing|ingly)|soft(?:ly)?|quiet(?:ly)?|kind(?:ly)?|soothing\w*|comfort\w*)\b/i],
  ['excited', /\b(laugh\w*|excit\w*|cheer\w*|glee\w*|enthusias\w*|delight\w*|beam\w*|proud\w*|joy\w*|happ(?:y|ily))\b/i],
  ['hesitant', /\b(hesitat\w*|uncertain\w*|stammer\w*|stutter\w*|trailing off|falter\w*|nervous\w*|unsure|pause\w*)\b/i],
  ['urgent', /\b(urgent\w*|hurried\w*|hurry|quick(?:ly)?|rush\w*|desperat\w*|pleading)\b/i],
  ['solemn', /\b(solemn\w*|grave(?:ly)?|slow(?:ly)?|deliberate\w*|heavily)\b/i],
  ['serious', /\b(serious\w*|firm(?:ly)?|stern\w*|sharply|insist\w*|command\w*)\b/i],
];

/** Which feeling a direction asks for: "in fright" → 'fright', "directly to biff" → 'neutral'. */
export function emotionFor(direction) {
  const hit = RULES.find(([, re]) => re.test(direction));
  return hit ? hit[0] : 'neutral';
}

/** Same numbers as the server: [rate %, pitch Hz, volume %]. Used when the device's own voice does the speaking. */
export const PRESETS = {
  neutral: [0, 0, 0], warm: [-3, 1, 0], excited: [8, 5, 5], serious: [-8, -3, 0], curious: [2, 4, 0], playful: [6, 4, 3],
  angry: [8, 3, 15], fright: [14, 8, -5], surprise: [4, 7, 5], sad: [-12, -4, -15], whisper: [-10, -2, -35], gentle: [-6, 1, -8],
  sarcastic: [-4, -5, 0], hesitant: [-8, 0, -5], urgent: [15, 2, 8], solemn: [-14, -3, -3],
};

/** Speech-synthesis settings for the browser engine: {rate multiplier, pitch (0–2), volume (0–1)}. */
export function deviceDelivery(emotion, shift = 0) {
  const [rate, hz, vol] = PRESETS[emotion] || PRESETS.neutral;
  return { rate: 1 + rate / 100, pitch: Math.max(0, Math.min(2, 1 + (hz + shift) / 40)), volume: Math.max(0.2, Math.min(1, 1 + vol / 100)) };
}

/** Removes every [bracketed] note from text that will be spoken (including a bracket left open or closed by a split). */
export function stripDirections(text) {
  return (text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\[[^\]]*$/, ' ').replace(/^[^[]*\]/, (m) => (m.includes('[') ? m : ' ')).replace(/\s+/g, ' ').trim();
}

// Words that open "Label: …" in ordinary prose and are not characters.
const NOT_NAMES = new Set(['his', 'her', 'their', 'my', 'your', 'our','note', 'notes', 'example', 'examples', 'warning', 'tip', 'step', 'question', 'answer', 'chapter', 'part', 'figure', 'table',
  'source', 'however', 'summary', 'conclusion', 'result', 'results', 'definition', 'remember', 'important', 'caution', 'hint', 'solution', 'problem']);
// an UPPERCASE running title glued to a page number: "DEATH OF A SALESMAN106"
const HEADER_RE = /(?<![A-Za-z0-9])[A-Z][A-Z'’.\- ]{5,}[A-Z]\s?\d{1,4}(?![A-Za-z0-9])/g;
const NAME = "[A-Za-z][A-Za-z'’-]{1,14}(?: [A-Za-z][A-Za-z'’-]{1,14})?";

/** Character names in a chapter: a name that introduces speech ("biff:", "willy [astonished]:") at least 3 times. */
export function findSpeakers(paragraphs) {
  const counts = new Map();
  const re = new RegExp(`(?:^|[.!?"”’\\]]\\s+)(${NAME})\\s*(?:\\[[^\\]]{0,240}\\])?\\s*:`, 'g');
  paragraphs.forEach((p) => {
    for (const m of p.matchAll(re)) {
      const name = m[1].toLowerCase();
      if (!NOT_NAMES.has(name) && !NOT_NAMES.has(name.split(' ')[0])) counts.set(name, (counts.get(name) || 0) + 1);
    }
  });
  const names = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return names.length >= 2 ? new Set(names) : new Set(); // one lonely "label:" is not a script
}

/**
 * Split one paragraph into spans.
 * @param ctx  {speakers:Set, speaker:string|null, open:boolean} — carried from paragraph to paragraph (a bracket can stay open)
 * @returns [{start, end, kind:'speech'|'silent', speaker, emotion}] — offsets into `p`, in order, covering the paragraph
 */
export function splitParagraph(p, ctx) {
  const spans = [];
  let emotion = 'neutral';
  let pending = 'neutral';

  const add = (start, end, kind) => {
    while (start < end && /\s/.test(p[start])) start += 1;
    while (end > start && /\s/.test(p[end - 1])) end -= 1;
    if (end <= start) return;
    if (kind === 'speech') {
      // punctuation left behind by a removed note ("…muscle [1]. See…") is not speech: don't voice a lone "."
      const lead = p.slice(start, end).match(/^[.,;:!?…)\]\s]+/);
      if (lead) {
        spans.push({ start, end: start + lead[0].length, kind: 'silent', speaker: ctx.speaker, emotion: 'neutral' });
        start += lead[0].length;
      }
      if (!/[\p{L}\p{N}]/u.test(p.slice(start, end))) kind = 'silent';
      if (end <= start) return;
    }
    spans.push({ start, end, kind, speaker: ctx.speaker, emotion: kind === 'speech' ? emotion : 'neutral' });
  };

  // 1. bracket ranges [open, close) — a bracket may span sentences, and may still be open at the end of the paragraph
  const brackets = [];
  let i = 0;
  if (ctx.open) {
    const close = p.indexOf(']');
    const reopen = p.indexOf('[');
    if (close >= 0 && (reopen < 0 || close < reopen)) { brackets.push([0, close + 1]); i = close + 1; ctx.open = false; }
    else if (close < 0 && reopen < 0) { brackets.push([0, p.length]); i = p.length; }
    else ctx.open = false;
  }
  while (i < p.length) {
    const open = p.indexOf('[', i);
    if (open < 0) break;
    const close = p.indexOf(']', open + 1);
    if (close < 0) { brackets.push([open, p.length]); ctx.open = true; break; }
    brackets.push([open, close + 1]);
    i = close + 1;
  }

  // 2. speech runs between brackets: character labels are silent and switch the speaker.
  //    (non-global regexes only — a shared /g regex keeps its position between calls)
  const names = [...ctx.speakers].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const labelSrc = names ? `(?<![A-Za-z'’-])(${names})\\s*:\\s*` : null;
  const trailingSrc = names ? `(?<![A-Za-z'’-])(${names})\\s*$` : null;

  const run = (a, b, attachedNext) => {
    let at = a;
    // ": text" right after "name [direction]" — the colon belongs to the label, and the direction's feeling starts here
    const lead = p.slice(at, b).match(/^\s*:\s*/);
    if (lead) { add(at, at + lead[0].length, 'silent'); at += lead[0].length; emotion = pending; }
    pending = 'neutral';

    while (at < b) {
      const text = p.slice(at, b);
      const label = labelSrc ? new RegExp(labelSrc, 'i').exec(text) : null;
      if (label) {
        add(at, at + label.index, 'speech');
        ctx.speaker = label[1].toLowerCase();
        emotion = 'neutral';
        add(at + label.index, at + label.index + label[0].length, 'silent');
        at += label.index + label[0].length;
        continue;
      }
      // a name directly before "[direction]:" is a label as well
      const tail = attachedNext && trailingSrc ? new RegExp(trailingSrc, 'i').exec(text) : null;
      if (tail) {
        add(at, at + tail.index, 'speech');
        ctx.speaker = tail[1].toLowerCase();
        emotion = 'neutral';
        add(at + tail.index, b, 'silent');
      } else {
        add(at, b, 'speech');
      }
      break;
    }
  };

  // running headers and page numbers a PDF carried into the text ("DEATH OF A SALESMAN106", a lone "52") are never read either
  const ranges = brackets.map(([a, b]) => [a, b, 'note']);
  const inBracket = (i) => brackets.some(([a, b]) => i >= a && i < b);
  if (/^\d{1,4}$/.test(p.trim())) ranges.push([0, p.length, 'header']);
  else for (const m of p.matchAll(HEADER_RE)) if (!inBracket(m.index)) ranges.push([m.index, m.index + m[0].length, 'header']);
  ranges.sort((x, y) => x[0] - y[0]);

  let cursor = 0;
  ranges.forEach(([open, close, kind]) => {
    if (open < cursor) return; // overlapped by an earlier range
    if (kind === 'header') {
      if (open > cursor) run(cursor, open, false);
      add(open, close, 'silent'); // feeling and speaker carry straight through a page break
      cursor = close;
      return;
    }
    const attachedNext = /^\s*:/.test(p.slice(close, close + 12));
    if (open > cursor) run(cursor, open, !!attachedNext);
    const inner = p.slice(open + 1, Math.max(open + 1, close - 1));
    add(open, close, 'silent');
    if (/^[\d\s,;–-]*$/.test(inner)) { /* citation: no change of feeling */ } else {
      pending = attachedNext ? emotionFor(inner) : 'neutral'; // "name [in fright]:" colours that line; a scene direction colours nothing
      if (!attachedNext) emotion = 'neutral';
    }
    cursor = close;
  });
  if (cursor < p.length) run(cursor, p.length, false);
  return spans;
}

