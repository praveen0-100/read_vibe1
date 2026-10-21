// ─── Narration engine (Web Speech API) ───────────────────────────────────────
// Plays a segmented narration script produced by the backend. Pausing cancels and
// resumes from the current segment, which is far more reliable across browsers than
// speechSynthesis.pause().

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const WPM = 165;

export function loadVoices() {
  if (!speechSupported) return Promise.resolve([]);
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Best default voice for a tone, preferring natural/neural English voices. */
export function pickVoice(voices, preferredName, tone = 'Regular') {
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  const english = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const pool = english.length ? english : voices;
  const natural = pool.filter((v) => /natural|neural|premium|enhanced|google/i.test(v.name));
  const ranked = natural.length ? natural : pool;
  if (tone === 'Tough') return ranked.find((v) => /male|guy|david|daniel|george|ryan|christopher/i.test(v.name)) || ranked[0];
  if (tone === 'Humor') return ranked.find((v) => /female|aria|jenny|samantha|zira|libby|sonia/i.test(v.name)) || ranked[0];
  return ranked[0];
}

const segSeconds = (seg, rate) => (seg.text.split(/\s+/).length / (WPM * rate)) * 60 + (seg.pause_ms || 0) / 1000;

export class Narrator {
  constructor() {
    this.script = [];
    this.chapter = 0;
    this.segment = 0;
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
    this.playing = false;
    this.listeners = new Set();
    this.token = 0;
    this.segmentStartedAt = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(extra = {}) {
    const s = this.state();
    this.listeners.forEach((fn) => fn({ ...s, ...extra }));
  }

  load(script, { rate = 1, pitch = 1, voice = null, chapter = 0, segment = 0 } = {}) {
    this.stop();
    this.script = script || [];
    this.rate = rate;
    this.pitch = pitch;
    this.voice = voice;
    this.chapter = Math.min(chapter, Math.max(0, this.script.length - 1));
    this.segment = segment;
    this.emit();
  }

  get current() {
    return this.script[this.chapter]?.segments?.[this.segment] || null;
  }

  chapterSeconds(i) {
    return (this.script[i]?.segments || []).reduce((sum, s) => sum + segSeconds(s, this.rate), 0);
  }

  get totalSeconds() {
    return this.script.reduce((sum, _, i) => sum + this.chapterSeconds(i), 0);
  }

  get elapsedSeconds() {
    let total = 0;
    for (let i = 0; i < this.chapter; i++) total += this.chapterSeconds(i);
    const segs = this.script[this.chapter]?.segments || [];
    for (let j = 0; j < this.segment && j < segs.length; j++) total += segSeconds(segs[j], this.rate);
    if (this.playing && this.segmentStartedAt) {
      const cur = this.current ? segSeconds(this.current, this.rate) : 0;
      total += Math.min(cur, (performance.now() - this.segmentStartedAt) / 1000);
    }
    return total;
  }

  state() {
    return {
      playing: this.playing,
      chapter: this.chapter,
      segment: this.segment,
      chapterTitle: this.script[this.chapter]?.title || '',
      text: this.current?.text || '',
      elapsed: this.elapsedSeconds,
      total: this.totalSeconds,
      rate: this.rate,
    };
  }

  play() {
    if (!speechSupported || !this.script.length) return;
    this.playing = true;
    this.speakCurrent();
  }

  speakCurrent() {
    const synth = window.speechSynthesis;
    const token = ++this.token;
    synth.cancel();
    const seg = this.current;
    if (!seg) {
      this.advance();
      return;
    }
    const u = new SpeechSynthesisUtterance(seg.text);
    u.rate = Math.max(0.1, Math.min(10, this.rate));
    u.pitch = Math.max(0, Math.min(2, this.pitch));
    if (this.voice) u.voice = this.voice;
    u.onstart = () => {
      if (token !== this.token) return;
      this.segmentStartedAt = performance.now();
      this.emit();
    };
    u.onboundary = (e) => {
      if (token === this.token && e.name === 'word') this.emit({ charIndex: e.charIndex });
    };
    u.onend = () => {
      if (token !== this.token || !this.playing) return;
      const pause = (seg.pause_ms || 0) / Math.max(0.5, this.rate);
      setTimeout(() => token === this.token && this.playing && this.advance(), pause);
    };
    u.onerror = (e) => {
      if (token !== this.token || e.error === 'interrupted' || e.error === 'canceled') return;
      this.playing = false;
      this.emit({ error: e.error });
    };
    synth.speak(u);
    this.emit();
  }

  advance() {
    const segs = this.script[this.chapter]?.segments || [];
    if (this.segment + 1 < segs.length) {
      this.segment += 1;
    } else if (this.chapter + 1 < this.script.length) {
      this.chapter += 1;
      this.segment = 0;
      this.emit({ chapterEnded: this.chapter - 1 });
      if (this.autoAdvance === false) {
        this.pause();
        return;
      }
    } else {
      this.playing = false;
      this.chapter = 0;
      this.segment = 0;
      this.emit({ finished: true });
      return;
    }
    this.speakCurrent();
  }

  pause() {
    this.playing = false;
    this.token++;
    if (speechSupported) window.speechSynthesis.cancel();
    this.segmentStartedAt = 0;
    this.emit();
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  stop() {
    this.pause();
  }

  seek(chapter, segment = 0) {
    this.chapter = Math.max(0, Math.min(chapter, this.script.length - 1));
    const segs = this.script[this.chapter]?.segments || [];
    this.segment = Math.max(0, Math.min(segment, segs.length - 1));
    if (this.playing) this.speakCurrent();
    else this.emit();
  }

  /** Seek to an absolute time (seconds) on the estimated timeline. */
  seekTime(seconds) {
    let t = 0;
    for (let c = 0; c < this.script.length; c++) {
      const segs = this.script[c].segments;
      for (let s = 0; s < segs.length; s++) {
        const d = segSeconds(segs[s], this.rate);
        if (t + d >= seconds) return this.seek(c, s);
        t += d;
      }
    }
    return this.seek(this.script.length - 1, Number.MAX_SAFE_INTEGER);
  }

  skip(seconds) {
    this.seekTime(Math.max(0, this.elapsedSeconds + seconds));
  }

  setRate(rate) {
    this.rate = rate;
    if (this.playing) this.speakCurrent();
    else this.emit();
  }

  setVoice(voice) {
    this.voice = voice;
    if (this.playing) this.speakCurrent();
  }

  destroy() {
    this.pause();
    this.listeners.clear();
  }
}

/** One-off speech (previews, read-aloud of a selection). Returns a cancel function. */
export function speak(text, { rate = 1, pitch = 1, voice = null, onEnd } = {}) {
  if (!speechSupported) return () => {};
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = pitch;
  if (voice) u.voice = voice;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return () => window.speechSynthesis.cancel();
}
