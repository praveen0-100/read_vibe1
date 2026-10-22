// ─── Natural (neural) voice clips ────────────────────────────────────────────
// Fetches synthesised speech for a sentence from the API, caches it in memory as a playable blob URL and keeps the
// per-word timings that drive word-by-word highlighting.

const MAX_CLIPS = 48;

// 0.1 s of silence — played inside the user's tap so mobile browsers allow later, programmatic playback
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const toBlobUrl = (base64, mime) => {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

export class NeuralClips {
  constructor(synth, voice) {
    this.synth = synth;
    this.voice = voice;
    this.clips = new Map(); // text → Promise<{url, words, timing}>
  }

  /** Promise of {url, words:[[charOffset, length, start, duration]], timing:'ms'|'fraction'} for a sentence. */
  get(text) {
    let hit = this.clips.get(text);
    if (hit) return hit;
    hit = this.synth(text, this.voice).then((r) => ({ url: toBlobUrl(r.audio, r.mime), words: r.words || [], timing: r.timing }));
    hit.catch(() => this.clips.delete(text)); // let a later attempt retry
    this.clips.set(text, hit);
    if (this.clips.size > MAX_CLIPS) {
      const [oldest] = this.clips.keys();
      this.clips.get(oldest)?.then((c) => URL.revokeObjectURL(c.url), () => {});
      this.clips.delete(oldest);
    }
    return hit;
  }

  dispose() {
    this.clips.forEach((p) => p.then((c) => URL.revokeObjectURL(c.url), () => {}));
    this.clips.clear();
  }
}

/** Word start times in ms (fractions are scaled by the clip's real duration). */
export function wordTimeline(clip, durationMs) {
  const scale = clip.timing === 'fraction' ? durationMs : 1;
  return clip.words.map(([o, l, t, d]) => ({ o, l, t: t * scale, d: d * scale }));
}

export function createPlayer() {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.preservesPitch = true;
  return audio;
}

/** Call synchronously from a tap/click handler. */
export function unlockAudio(audio) {
  if (!audio || audio.dataset.unlocked) return;
  audio.dataset.unlocked = '1';
  audio.src = SILENCE;
  audio.play().catch(() => { delete audio.dataset.unlocked; });
}
