// ─── Narration engine (Web Speech API) ───────────────────────────────────────
// Plays a segmented narration script produced by the backend. Pausing cancels and
// resumes from the current segment, which is far more reliable across browsers than
// speechSynthesis.pause().

import { NeuralClips, createPlayer, unlockAudio, wordTimeline } from './neuralVoice';
import { deviceDelivery } from './stageDirections';

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
const WPM = 165;

/** A browser voice for a language code ('ta', 'te' …), or null when the device has none. */
export function pickVoiceForLang(voices, lang) {
  const l = (lang || '').toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(`${l}-in`)) || voices.find((v) => v.lang.toLowerCase().startsWith(l)) || null;
}

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

// a silent segment (a stage direction, a speaker label) takes only its pause
const segSeconds = (seg, rate) => (seg.silent ? 0 : (seg.text.split(/\s+/).length / (WPM * rate)) * 60) + (seg.pause_ms || 0) / 1000;
// how a sentence should sound: its feeling and character voice, plus where it sits in its paragraph (openings lift, endings settle)
const positionOf = (seg) => seg.position || (seg.first ? 'start' : (seg.pause_ms || 0) >= 400 ? 'end' : 'mid');
const deliveryOf = (seg) => ({ emotion: seg.emotion, shift: seg.shift, natural: true, position: positionOf(seg) });
// the breath after a sentence varies a little (deterministically), so the gaps are not a metronome
const breath = (seg) => { let h = 0; for (let i = 0; i < Math.min(seg.text.length, 24); i++) h = (h * 31 + seg.text.charCodeAt(i)) % 997; return 0.85 + (h % 36) / 100; };
const LOOKAHEAD = 3; // units (a few sentences each) fetched ahead of the one being read
const STALL_MS = 8000; // no audio progress for this long while playing: recover

// ─── Utterance units ─────────────────────────────────────────────────────────
// Reading sentence by sentence means a clip ends and the next one starts at every full stop (and at every "Mr.", quote or dash
// that cuts a fragment) — each join costs the clip's own padding plus the time to load the next. So consecutive sentences with only a
// short pause between them are voiced as ONE unit: the engine phrases the full stops itself, there is nothing to join, and the
// transcript still follows sentence by sentence because every word is mapped back to the sentence it belongs to.
const JOIN_PAUSE_MAX = 260; // a longer pause after a sentence (a paragraph end, a slow tone's deliberate beat) always starts a new unit
const UNIT_MAX = 520; // characters per unit

const unitKey = (s) => (s.voice || '') + '|' + (s.speaker || '') + '|' + (s.emotion || '') + '|' + (s.shift || 0);

/** → {units:[{start,end,text,offsets[],silent}], of:[unit index of each segment]} */
export function buildUnits(segs) {
  const units = [];
  const of = new Array(segs.length);
  let cur = null;
  segs.forEach((seg, i) => {
    if (seg.silent) { units.push({ start: i, end: i, silent: true, text: seg.text, offsets: [0] }); of[i] = units.length - 1; cur = null; return; }
    const prev = segs[i - 1];
    const joins = cur && !prev.silent && (prev.pause_ms || 0) <= JOIN_PAUSE_MAX && unitKey(seg) === cur.key && cur.text.length + 1 + seg.text.length <= UNIT_MAX;
    if (!joins) { cur = { start: i, end: i, key: unitKey(seg), text: '', offsets: [], silent: false }; units.push(cur); }
    cur.offsets.push(cur.text ? cur.text.length + 1 : 0);
    cur.text += (cur.text ? ' ' : '') + seg.text;
    cur.end = i;
    of[i] = units.length - 1;
  });
  return { units, of };
}

/** Which sentence of the unit a character offset falls in, and where inside that sentence. */
const locate = (unit, o) => {
  let k = 0;
  for (let j = 0; j < unit.offsets.length; j++) if (unit.offsets[j] <= o) k = j;
  return { k, char: o - unit.offsets[k] };
};

// a unit takes the delivery of the sentence it opens (or, failing that, the one it closes), so the paragraph shape is kept
const deliveryOfUnit = (unit, segs) => {
  if (unit.start === unit.end) return deliveryOf(segs[unit.start]);
  const first = deliveryOf(segs[unit.start]);
  if (first.position === 'start') return first;
  const last = deliveryOf(segs[unit.end]);
  return last.position === 'end' ? last : first;
};

/** Symbols that make a voice stop or stumble become plain pauses. Same length as the input, so every character offset still lines up. */
export const speakable = (t) => (t || '')
  .replace(/[*_~^|\\#•·▪▫◦●○■□★☆►▶◄◀→←↑↓§¶†‡]/g, ' ')
  .replace(/[—–―‒]/g, ',')
  .replace(/\.\.\./g, ',  ')
  .replace(/…/g, ',')
  .replace(/--/g, ', ')
  .replace(/(?<=\s)-(?=\s)/g, ',');

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
    this.buffering = false; // waiting for the voice (shown in the transcript as a pulse)
    this.failStreak = 0; // sentences in a row the voice service could not deliver
    this.savedClips = null; // natural clips set aside while one sentence is read by the device voice
    this.warmToken = 0;
    this.spare = null; // a second player that already holds the next unit, so one follows the other with no gap
    this.spareFor = null;
    this._units = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(extra = {}) {
    const s = this.state();
    this.listeners.forEach((fn) => fn({ ...s, ...extra }));
  }

  /** `neural: {synth(text, voice) → Promise, voice}` switches to natural voices; omit it for browser voices. */
  load(script, { rate = 1, pitch = 1, voice = null, chapter = 0, segment = 0, offset = 0, neural = null, lang = '' } = {}) {
    this.stop();
    this.clips?.dispose();
    this.clips = neural ? new NeuralClips(neural.synth, neural.voice) : null;
    this.savedClips = null;
    this.failStreak = 0;
    this.spareFor = null;
    this._units = null;
    this.script = script || [];
    this.rate = rate;
    this.pitch = pitch;
    this.voice = voice;
    this.lang = lang; // BCP-47 hint (e.g. 'ta-IN') so the browser picks a matching voice when none is chosen
    this.chapter = Math.min(chapter, Math.max(0, this.script.length - 1));
    this.segment = segment;
    this.offset = offset;
    this.charIndex = offset;
    this.emit();
  }

  get current() {
    return this.script[this.chapter]?.segments?.[this.segment] || null;
  }

  /** The chapter's sentences grouped into units (cached until the script or chapter changes). */
  get units() {
    if (!this._units || this._units.script !== this.script || this._units.chapter !== this.chapter) {
      this._units = { script: this.script, chapter: this.chapter, ...buildUnits(this.script[this.chapter]?.segments || []) };
    }
    return this._units;
  }

  get unit() {
    const u = this.units;
    return u.units[u.of[this.segment]] || null;
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
      buffering: this.buffering,
    };
  }

  /** Call inside a tap before the script exists: unlocks audio so playback can start later without another gesture. */
  prime() {
    this.audio ||= createPlayer();
    unlockAudio(this.audio);
    this.spare ||= createPlayer();
    unlockAudio(this.spare);
  }

  play() {
    if (!this.script.length || (!speechSupported && !this.clips)) return;
    if (this.clips) {
      this.audio ||= createPlayer();
      unlockAudio(this.audio);
      this.spare ||= createPlayer();
      unlockAudio(this.spare);
    }
    this.playing = true;
    this.speakCurrent();
  }

  /** Natural voice: play the unit's neural clip, following its word timings and keeping the current sentence in step. */
  async speakNeural() {
    const token = ++this.token;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    if (speechSupported) window.speechSynthesis.cancel();
    const seg = this.current;
    const unit = this.unit;
    if (!seg || !unit) { this.advance(); return; }
    const segs = this.script[this.chapter].segments;
    const voice = segs[unit.start].voice;
    const delivery = deliveryOfUnit(unit, segs);
    const startOffset = unit.offsets[this.segment - unit.start] + this.offset;
    const clips = this.clips;

    let clip;
    clips.get(unit.text, voice, delivery).catch(() => {}); // what is being read always goes first...
    this.warmAhead(); // ...then the units after it are fetched, one after another
    const waiting = clips.has(unit.text, voice, delivery) ? 0 : setTimeout(() => { if (token === this.token) { this.buffering = true; this.emit(); } }, 250);
    try {
      let lastErr;
      for (let attempt = 0; attempt < 3 && !clip; attempt++) { // the voice service often fails once while it wakes
        if (attempt) await new Promise((r) => setTimeout(r, 500 * attempt));
        if (token !== this.token) return;
        try { clip = await clips.get(unit.text, voice, delivery); } catch (e) { lastErr = e; }
      }
      if (!clip) throw lastErr;
      this.failStreak = 0;
    } catch (err) {
      if (waiting) clearTimeout(waiting);
      if (token !== this.token) return;
      this.buffering = false;
      this.failStreak += 1;
      // one stubborn passage is read by the device voice; the natural voice resumes with the next. Only a run of failures gives up on it.
      if (this.failStreak >= 3) this.clips = null;
      else if (!this.needsDeviceVoice()) { this.savedClips = clips; this.clips = null; }
      if (this.needsDeviceVoice()) {
        // the device has no voice for this language: its default (English) voice would garble the text at speed, so stop instead
        this.playing = false;
        this.emit({ neuralFailed: err?.message || 'Natural voices are unavailable', error: 'no-voice' });
        return;
      }
      // the voice service is unreachable: carry on with the browser's voice instead of going silent
      this.emit({ neuralFailed: err?.message || 'Natural voices are unavailable' });
      this.speakCurrent();
      return;
    }
    if (waiting) clearTimeout(waiting);
    if (this.buffering) { this.buffering = false; this.emit(); }
    if (token !== this.token || !this.playing) return;

    // gapless: when this unit was already loaded into the spare player, that player simply becomes the main one
    let audio = this.audio;
    if (this.spare && this.spareFor === clip.url) {
      const old = this.audio;
      old.onended = old.onerror = old.onloadedmetadata = null;
      old.pause();
      this.audio = this.spare;
      this.spare = old;
      audio = this.audio;
    } else {
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      audio.src = clip.url;
    }
    this.spareFor = null;
    audio.playbackRate = this.rate;
    audio.preservesPitch = true;

    let timeline = [];
    let at = -1;
    let lastTime = -1;
    let lastMoved = performance.now();
    let recoveries = 0;
    const track = () => {
      if (token !== this.token) return;
      const ms = audio.currentTime * 1000;
      if (ms !== lastTime) { lastTime = ms; lastMoved = performance.now(); if (this.buffering) { this.buffering = false; this.emit(); } }
      else if (!audio.paused && !audio.ended && performance.now() - lastMoved > 1200 && !this.buffering) { this.buffering = true; this.emit(); }
      if (performance.now() - lastMoved > STALL_MS) {
        // the audio stopped moving: retry from the last word, and if it keeps stalling move on rather than hang
        if (++recoveries > 2) { this.buffering = false; this.segment = unit.end; this.advance(); return; }
        lastMoved = performance.now();
        this.offset = this.charIndex;
        this.speakCurrent();
        return;
      }
      let i = Math.max(0, at);
      while (i + 1 < timeline.length && timeline[i + 1].t <= ms) i += 1;
      if (timeline[i] && i !== at) {
        at = i;
        const here = locate(unit, timeline[i].o); // which sentence of the unit this word belongs to
        const seg2 = unit.start + here.k;
        if (seg2 !== this.segment) { this.segment = seg2; this.segmentStartedAt = performance.now(); }
        this.offset = 0;
        this.charIndex = here.char;
        this.emit({ charIndex: this.charIndex });
      }
      this.raf = requestAnimationFrame(track);
    };

    const init = () => {
      timeline = wordTimeline(clip, (audio.duration || 0) * 1000);
      if (startOffset > 0) {
        const w = timeline.find((x) => x.o + x.l > startOffset);
        if (w) audio.currentTime = w.t / 1000;
      }
    };
    audio.onloadedmetadata = init;
    if (audio.readyState >= 1) init(); // a preloaded player has its metadata already
    audio.onended = () => {
      if (token !== this.token || !this.playing) return;
      cancelAnimationFrame(this.raf);
      const last = segs[unit.end];
      const pause = ((last.pause_ms || 0) * 0.5 * breath(last)) / Math.max(0.5, this.rate); // clips already carry a little trailing silence
      const next = () => { if (token === this.token && this.playing) { this.segment = unit.end; this.advance(); } };
      if (pause > 30) setTimeout(next, pause); else next();
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
    this.preloadNext(token, unit);
  }

  /** Load the next unit into the spare player while this one plays, so the hand-over has nothing left to load. */
  async preloadNext(token, unit) {
    const clips = this.clips;
    const { units, of } = this.units;
    const next = units[of[unit.start] + 1];
    if (!clips || !next || next.silent) return;
    const segs = this.script[this.chapter].segments;
    try {
      const c = await clips.get(next.text, segs[next.start].voice, deliveryOfUnit(next, segs));
      if (token !== this.token || clips !== this.clips) return;
      this.spare ||= createPlayer();
      this.spare.onended = this.spare.onerror = this.spare.onloadedmetadata = null;
      this.spare.src = c.url;
      this.spare.preload = 'auto';
      this.spare.load();
      this.spareFor = c.url;
    } catch { /* it will be fetched normally when reached */ }
  }

  /** Fetch the next units one after another (never all at once, so the one being read is not starved). */
  async warmAhead() {
    const clips = this.clips;
    const mine = ++this.warmToken;
    const segs = this.script[this.chapter]?.segments || [];
    const { units, of } = this.units;
    for (let i = of[this.segment] + 1, n = 0; i < units.length && n < LOOKAHEAD; i++) {
      const next = units[i];
      if (next.silent) continue; // nothing to synthesise for a direction
      n += 1;
      try { await clips.get(next.text, segs[next.start].voice, deliveryOfUnit(next, segs)); } catch { /* retried when it is reached */ }
      if (mine !== this.warmToken || clips !== this.clips) return;
    }
  }

  /** A direction or label: show it, say nothing, move on after a beat. */
  skipSilent(seg) {
    const token = ++this.token;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    if (speechSupported) window.speechSynthesis.cancel();
    this.offset = 0;
    this.charIndex = 0;
    this.segmentStartedAt = performance.now();
    this.emit();
    const wait = (seg.pause_ms || 120) / Math.max(0.5, this.rate);
    setTimeout(() => token === this.token && this.playing && this.advance(), wait);
  }

  /** True when the text is not English and the device has no voice for it (the default voice would mispronounce it). */
  needsDeviceVoice() {
    return !this.voice && !!this.lang && !/^en/i.test(this.lang);
  }

  speakCurrent() {
    if (this.current?.silent) { this.skipSilent(this.current); return; }
    if (this.clips) { this.speakNeural(); return; }
    if (this.needsDeviceVoice()) {
      this.playing = false;
      this.emit({ error: 'no-voice' });
      return;
    }
    const synth = window.speechSynthesis;
    const token = ++this.token;
    synth.cancel();
    const seg = this.current;
    const unit = this.unit;
    if (!seg || !unit) {
      this.advance();
      return;
    }
    const segs = this.script[this.chapter].segments;
    const first = segs[unit.start];
    const text = speakable(unit.text);
    const skip = Math.min(unit.offsets[this.segment - unit.start] + this.offset, Math.max(0, text.length - 1));
    const u = new SpeechSynthesisUtterance(skip ? text.slice(skip) : text);
    const feel = deviceDelivery(first.emotion, first.shift || 0); // the direction's feeling, on the device's own voice
    u.rate = Math.max(0.1, Math.min(10, this.rate * feel.rate));
    u.pitch = Math.max(0, Math.min(2, this.pitch * feel.pitch));
    u.volume = feel.volume;
    if (this.voice) u.voice = this.voice;
    else if (this.lang) u.lang = this.lang;
    u.onstart = () => {
      if (token !== this.token) return;
      this.segmentStartedAt = performance.now();
      this.emit();
    };
    u.onboundary = (e) => {
      if (token !== this.token || e.name !== 'word') return;
      const here = locate(unit, skip + e.charIndex);
      const seg2 = unit.start + here.k;
      if (seg2 !== this.segment) { this.segment = seg2; this.segmentStartedAt = performance.now(); }
      this.offset = 0;
      this.charIndex = here.char;
      this.emit({ charIndex: this.charIndex });
    };
    u.onend = () => {
      if (token !== this.token || !this.playing) return;
      const pause = (segs[unit.end].pause_ms || 0) / Math.max(0.5, this.rate);
      setTimeout(() => { if (token === this.token && this.playing) { this.segment = unit.end; this.advance(); } }, pause);
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
    if (this.savedClips) { this.clips = this.savedClips; this.savedClips = null; } // back to the natural voice after a one-sentence fallback
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
    this.warmToken++;
    this.buffering = false;
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
    if (this.spare) { this.spare.removeAttribute('src'); this.spare.load(); this.spare = null; }
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
