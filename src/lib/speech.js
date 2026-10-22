// ─── Narration engine (Web Speech API) ───────────────────────────────────────
// Plays a segmented narration script produced by the backend. Pausing cancels and
// resumes from the current segment, which is far more reliable across browsers than
// speechSynthesis.pause().

import { NeuralClips, createPlayer, unlockAudio, wordTimeline } from './neuralVoice';

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
    this.offset = 0; // characters of the current segment to skip (start speaking from a tapped word)
    this.charIndex = 0; // last word boundary reached inside the current segment
    this.clips = null; // natural-voice clips (null → the browser's own voices)
    this.audio = null;
    this.raf = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(extra = {}) {
    const s = this.state();
    this.listeners.forEach((fn) => fn({ ...s, ...extra }));
  }

  /** `neural: {synth(text, voice) → Promise, voice}` switches to natural voices; omit it for browser voices. */
  load(script, { rate = 1, pitch = 1, voice = null, chapter = 0, segment = 0, offset = 0, neural = null } = {}) {
    this.stop();
    this.clips?.dispose();
    this.clips = neural ? new NeuralClips(neural.synth, neural.voice) : null;
    this.script = script || [];
    this.rate = rate;
    this.pitch = pitch;
    this.voice = voice;
    this.chapter = Math.min(chapter, Math.max(0, this.script.length - 1));
    this.segment = segment;
    this.offset = offset;
    this.charIndex = offset;
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
      charIndex: this.charIndex,
      elapsed: this.elapsedSeconds,
      total: this.totalSeconds,
      rate: this.rate,
    };
  }

  play() {
    if (!this.script.length || (!speechSupported && !this.clips)) return;
    if (this.clips) {
      this.audio ||= createPlayer();
      unlockAudio(this.audio);
    }
    this.playing = true;
    this.speakCurrent();
  }

  /** Natural voice: play the sentence's neural clip, following its word timings. */
  async speakNeural() {
    const token = ++this.token;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    if (speechSupported) window.speechSynthesis.cancel();
    const seg = this.current;
    if (!seg) { this.advance(); return; }
    const startOffset = this.offset;
    const clips = this.clips;

    let clip;
    try {
      clip = await clips.get(seg.text);
    } catch (err) {
      if (token !== this.token) return;
      // the voice service is unreachable: carry on with the browser's voice instead of going silent
      this.clips = null;
      this.emit({ neuralFailed: err?.message || 'Natural voices are unavailable' });
      this.speakCurrent();
      return;
    }
    if (token !== this.token || !this.playing) return;

    // warm the next sentences so playback is gapless
    const segs = this.script[this.chapter]?.segments || [];
    for (let i = 1; i <= 2; i++) if (segs[this.segment + i]) clips.get(segs[this.segment + i].text).catch(() => {});

    const audio = this.audio;
    audio.onended = audio.onerror = audio.onloadedmetadata = null;
    audio.src = clip.url;
    audio.playbackRate = this.rate;
    audio.preservesPitch = true;

    let timeline = [];
    let at = -1;
    const track = () => {
      if (token !== this.token) return;
      const ms = audio.currentTime * 1000;
      let i = Math.max(0, at);
      while (i + 1 < timeline.length && timeline[i + 1].t <= ms) i += 1;
      if (timeline[i] && i !== at) {
        at = i;
        this.charIndex = timeline[i].o;
        this.emit({ charIndex: this.charIndex });
      }
      this.raf = requestAnimationFrame(track);
    };

    audio.onloadedmetadata = () => {
      timeline = wordTimeline(clip, (audio.duration || 0) * 1000);
      if (startOffset > 0) {
        const w = timeline.find((x) => x.o + x.l > startOffset);
        if (w) audio.currentTime = w.t / 1000;
      }
    };
    audio.onended = () => {
      if (token !== this.token || !this.playing) return;
      cancelAnimationFrame(this.raf);
      const pause = ((seg.pause_ms || 0) * 0.5) / Math.max(0.5, this.rate); // clips already carry a little trailing silence
      setTimeout(() => token === this.token && this.playing && this.advance(), pause);
    };
    audio.onerror = () => {
      if (token !== this.token) return;
      this.playing = false;
      cancelAnimationFrame(this.raf);
      this.emit({ error: 'playback' });
    };
    try {
      await audio.play();
    } catch (err) {
      if (token !== this.token) return;
      this.playing = false;
      this.emit({ error: err?.name === 'NotAllowedError' ? 'blocked' : 'playback' });
      return;
    }
    this.segmentStartedAt = performance.now();
    this.raf = requestAnimationFrame(track);
    this.emit();
  }

  speakCurrent() {
    if (this.clips) { this.speakNeural(); return; }
    const synth = window.speechSynthesis;
    const token = ++this.token;
    synth.cancel();
    const seg = this.current;
    if (!seg) {
      this.advance();
      return;
    }
    const skip = Math.min(this.offset, Math.max(0, seg.text.length - 1));
    const u = new SpeechSynthesisUtterance(skip ? seg.text.slice(skip) : seg.text);
    u.rate = Math.max(0.1, Math.min(10, this.rate));
    u.pitch = Math.max(0, Math.min(2, this.pitch));
    if (this.voice) u.voice = this.voice;
    u.onstart = () => {
      if (token !== this.token) return;
      this.segmentStartedAt = performance.now();
      this.emit();
    };
    u.onboundary = (e) => {
      if (token !== this.token || e.name !== 'word') return;
      this.charIndex = skip + e.charIndex;
      this.emit({ charIndex: this.charIndex });
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
    this.offset = 0;
    this.charIndex = 0;
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
    // remember the last spoken word so play() resumes there instead of repeating the sentence
    if (this.playing) this.offset = this.charIndex;
    this.playing = false;
    this.token++;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    if (speechSupported) window.speechSynthesis.cancel();
    this.segmentStartedAt = 0;
    this.emit();
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  stop() {
    this.pause();
  }

  /** Jump to a sentence — or, with `offset`, to a word inside it. */
  seek(chapter, segment = 0, offset = 0) {
    this.chapter = Math.max(0, Math.min(chapter, this.script.length - 1));
    const segs = this.script[this.chapter]?.segments || [];
    this.segment = Math.max(0, Math.min(segment, segs.length - 1));
    this.offset = offset;
    this.charIndex = offset;
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
    if (this.playing && this.clips && this.audio) {
      this.audio.playbackRate = rate; // natural voice: just change the playback speed, no restart
      this.emit();
    } else if (this.playing) {
      this.offset = this.charIndex; // carry on from the current word at the new speed
      this.speakCurrent();
    } else this.emit();
  }

  setVoice(voice) {
    this.voice = voice;
    if (this.playing) {
      this.offset = this.charIndex;
      this.speakCurrent();
    }
  }

  destroy() {
    this.pause();
    this.clips?.dispose();
    this.clips = null;
    if (this.audio) { this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; }
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
