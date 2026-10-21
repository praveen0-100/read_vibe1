// ─── Vibe Reader music engine ────────────────────────────────────────────────
// Plays the reader's local music files, or a built-in generative lo-fi stream,
// and exposes a frequency analyser so the visualiser reacts to the real audio.

const CHORDS = [
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 349.23], // G7
  [164.81, 196.0, 246.94, 293.66], // Em7
];

export const GENERATIVE_STATIONS = [
  { id: 'lofi', name: 'Lo-fi study stream', bpm: 72, mood: 'calm' },
  { id: 'dream', name: 'Dream pads', bpm: 56, mood: 'dreamy' },
  { id: 'pulse', name: 'Night drive pulse', bpm: 96, mood: 'energetic' },
];

export class VibePlayer {
  constructor() {
    this.ctx = null;
    this.audio = null;
    this.playlist = [];
    this.index = 0;
    this.mode = 'generative'; // 'generative' | 'local'
    this.station = GENERATIVE_STATIONS[0];
    this.volume = 0.6;
    this.listeners = new Set();
    this.genTimer = null;
    this.playing = false;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this.state())); }

  state() {
    const track = this.mode === 'local' ? this.playlist[this.index] : null;
    return {
      playing: this.playing,
      mode: this.mode,
      title: track ? track.name : this.station.name,
      subtitle: track ? `Local file · ${this.index + 1} of ${this.playlist.length}` : `Generative · ${this.station.bpm} BPM · ${this.station.mood}`,
      hasPlaylist: this.playlist.length > 0,
      current: this.audio?.currentTime || 0,
      duration: this.audio?.duration || 0,
    };
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.out.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Returns `count` levels in 0..1 for the visualiser. */
  levels(count) {
    if (!this.analyser || !this.playing) return null;
    this.analyser.getByteFrequencyData(this.bins);
    const usable = Math.floor(this.bins.length * 0.75);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      // log-ish spread so bass doesn't dominate
      const start = Math.floor((i / count) ** 1.6 * usable);
      const end = Math.max(start + 1, Math.floor(((i + 1) / count) ** 1.6 * usable));
      let sum = 0;
      for (let j = start; j < end; j++) sum += this.bins[j];
      out[i] = Math.min(1, (sum / (end - start)) / 200);
    }
    return out;
  }

  setVolume(v) {
    this.volume = v / 100;
    if (this.out) this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  loadFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
    if (!list.length) return 0;
    this.playlist.forEach((t) => URL.revokeObjectURL(t.url));
    this.playlist = list.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    this.index = 0;
    this.mode = 'local';
    this.emit();
    return list.length;
  }

  useStation(id) {
    this.station = GENERATIVE_STATIONS.find((s) => s.id === id) || GENERATIVE_STATIONS[0];
    const wasPlaying = this.playing;
    this.stopAll();
    this.mode = 'generative';
    if (wasPlaying) this.play();
    else this.emit();
  }

  async play() {
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.mode === 'local' && this.playlist.length) await this.playLocal();
    else this.startGenerative();
    this.playing = true;
    this.emit();
  }

  async playLocal() {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.crossOrigin = 'anonymous';
      this.mediaSource = this.ctx.createMediaElementSource(this.audio);
      this.mediaSource.connect(this.out);
      this.audio.addEventListener('ended', () => this.next());
      this.audio.addEventListener('timeupdate', () => this.emit());
    }
    const track = this.playlist[this.index];
    if (this.audio.src !== track.url) this.audio.src = track.url;
    await this.audio.play();
  }

  startGenerative() {
    if (this.genTimer) return;
    const beat = 60 / this.station.bpm;
    let step = 0;
    let nextTime = this.ctx.currentTime + 0.1;
    const schedule = () => {
      while (nextTime < this.ctx.currentTime + 0.4) {
        this.scheduleStep(step, nextTime, beat);
        nextTime += beat / 2;
        step = (step + 1) % 32;
      }
    };
    schedule();
    this.genTimer = setInterval(schedule, 100);
  }

  scheduleStep(step, t, beat) {
    const ctx = this.ctx;
    const id = this.station.id;
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    if (step % 8 === 0) {
      chord.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        o.type = id === 'pulse' ? 'sawtooth' : 'triangle';
        o.frequency.value = f * (id === 'dream' ? 1 : 0.5) * (i === 0 ? 0.5 : 1);
        o.detune.value = (Math.random() - 0.5) * 12;
        lp.type = 'lowpass';
        lp.frequency.value = id === 'pulse' ? 1400 : 900;
        const len = beat * 4;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(id === 'dream' ? 0.07 : 0.05, t + (id === 'dream' ? 1.2 : 0.2));
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(lp).connect(g).connect(this.out);
        o.start(t);
        o.stop(t + len + 0.1);
      });
    }
    if (id === 'dream') {
      if (step % 4 === 2) this.pluck(chord[(step / 2) % 4 | 0] * 2, t, 0.03);
      return;
    }
    if (step % 4 === 0) this.kick(t);
    if (step % 8 === 4) this.snare(t);
    if (step % 2 === 1 || id === 'pulse') this.hat(t, step % 4 === 3 ? 0.05 : 0.025);
    if (step % 4 === 2 && Math.random() > 0.35) this.pluck(chord[Math.floor(Math.random() * 4)] * 2, t, 0.04);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  noise(t, dur, freq, vol, type = 'highpass') {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
  }

  snare(t) { this.noise(t, 0.18, 1800, 0.18, 'bandpass'); }
  hat(t, vol) { this.noise(t, 0.05, 7000, vol); }

  pluck(freq, t, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.7);
  }

  stopAll() {
    clearInterval(this.genTimer);
    this.genTimer = null;
    this.audio?.pause();
  }

  pause() {
    this.stopAll();
    this.playing = false;
    this.emit();
  }

  toggle() { return this.playing ? this.pause() : this.play(); }

  next() {
    if (this.mode === 'local' && this.playlist.length) {
      this.index = (this.index + 1) % this.playlist.length;
      if (this.playing) this.playLocal();
      this.emit();
    } else {
      const i = GENERATIVE_STATIONS.indexOf(this.station);
      this.useStation(GENERATIVE_STATIONS[(i + 1) % GENERATIVE_STATIONS.length].id);
    }
  }

  prev() {
    if (this.mode === 'local' && this.playlist.length) {
      if (this.audio && this.audio.currentTime > 3) this.audio.currentTime = 0;
      else this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
      if (this.playing) this.playLocal();
      this.emit();
    } else {
      const i = GENERATIVE_STATIONS.indexOf(this.station);
      this.useStation(GENERATIVE_STATIONS[(i - 1 + GENERATIVE_STATIONS.length) % GENERATIVE_STATIONS.length].id);
    }
  }

  dispose() {
    this.stopAll();
    this.playing = false;
    this.playlist.forEach((t) => URL.revokeObjectURL(t.url));
    this.ctx?.close();
    this.ctx = null;
    this.audio = null; // its MediaElementSource is bound to the closed context
    this.listeners.clear();
  }
}
