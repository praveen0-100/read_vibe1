// ─── Generative ambient soundscapes (Web Audio API) ──────────────────────────
// Every layer is synthesised live — no audio files to download, works offline,
// loops seamlessly and can be mixed freely (the Zen "nature ambience mixer").

export const SOUND_LAYERS = [
  { id: 'rain', label: 'Rain', emoji: '🌧' },
  { id: 'forest', label: 'Forest', emoji: '🌲' },
  { id: 'ocean', label: 'Ocean', emoji: '🌊' },
  { id: 'cafe', label: 'Café', emoji: '☕' },
  { id: 'fire', label: 'Fireplace', emoji: '🔥' },
  { id: 'binaural', label: 'Focus beats', emoji: '🎧' },
  { id: 'white', label: 'Soft noise', emoji: '〰' },
];

function noiseBuffer(ctx, type = 'white', seconds = 4) {
  const len = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852; b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (type === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white * 0.5;
      }
    }
  }
  return buffer;
}

class Layer {
  constructor(engine, id) {
    this.engine = engine;
    this.id = id;
    this.ctx = engine.ctx;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(engine.master);
    this.nodes = [];
    this.timers = [];
    this.build();
  }

  source(type, { filter, freq, q = 0.7, gain = 1 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.engine.buffers[type];
    src.loop = true;
    let node = src;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      node.connect(f);
      node = f;
      this.nodes.push(f);
    }
    const g = this.ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    g.connect(this.gain);
    src.start(0, Math.random() * 3);
    this.nodes.push(src, g);
    return g;
  }

  lfo(target, rate, depth, base) {
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.frequency.value = rate;
    amp.gain.value = depth;
    target.value = base;
    osc.connect(amp);
    amp.connect(target);
    osc.start();
    this.nodes.push(osc, amp);
  }

  every(minMs, maxMs, fn) {
    const tick = () => {
      if (this.stopped) return;
      fn();
      this.timers.push(setTimeout(tick, minMs + Math.random() * (maxMs - minMs)));
    };
    this.timers.push(setTimeout(tick, Math.random() * maxMs));
  }

  blip({ freqFrom, freqTo, duration, type = 'sine', volume = 0.05, pan = 0 }) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(this.gain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  burst({ freq = 3000, duration = 0.03, volume = 0.2, pan = 0, type = 'white' }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.engine.buffers[type];
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(p).connect(this.gain);
    src.start(t, Math.random() * 3, duration + 0.05);
  }

  build() {
    switch (this.id) {
      case 'rain':
        this.source('pink', { filter: 'highpass', freq: 600, gain: 0.9 });
        this.source('white', { filter: 'bandpass', freq: 5200, q: 0.4, gain: 0.25 });
        this.every(25, 140, () => this.burst({ freq: 2200 + Math.random() * 4000, duration: 0.02 + Math.random() * 0.03, volume: 0.12 + Math.random() * 0.15, pan: Math.random() * 2 - 1 }));
        break;
      case 'forest': {
        const wind = this.source('pink', { filter: 'lowpass', freq: 500, gain: 0.7 });
        this.lfo(wind.gain, 0.07, 0.35, 0.6);
        this.every(1800, 6500, () => {
          const base = 2400 + Math.random() * 1800;
          const pan = Math.random() * 1.6 - 0.8;
          const notes = 2 + Math.floor(Math.random() * 4);
          for (let i = 0; i < notes; i++) {
            setTimeout(() => !this.stopped && this.blip({ freqFrom: base, freqTo: base * (1.2 + Math.random() * 0.5), duration: 0.09 + Math.random() * 0.08, volume: 0.035, pan }), i * (110 + Math.random() * 60));
          }
        });
        break;
      }
      case 'ocean': {
        const surf = this.source('brown', { filter: 'lowpass', freq: 900, gain: 0.8 });
        this.lfo(surf.gain, 0.11, 0.55, 0.6);
        const hiss = this.source('pink', { filter: 'highpass', freq: 2500, gain: 0.15 });
        this.lfo(hiss.gain, 0.11, 0.12, 0.13);
        break;
      }
      case 'cafe':
        this.source('brown', { filter: 'bandpass', freq: 420, q: 0.6, gain: 1.1 });
        this.source('pink', { filter: 'bandpass', freq: 1100, q: 0.8, gain: 0.18 });
        this.every(2500, 9000, () => this.blip({ freqFrom: 2600 + Math.random() * 1500, freqTo: 2500 + Math.random() * 1200, duration: 0.25, type: 'triangle', volume: 0.025, pan: Math.random() * 2 - 1 }));
        break;
      case 'fire':
        this.source('brown', { filter: 'lowpass', freq: 320, gain: 1.0 });
        this.every(40, 420, () => this.burst({ freq: 900 + Math.random() * 3000, duration: 0.008 + Math.random() * 0.02, volume: 0.25 + Math.random() * 0.4, pan: Math.random() * 0.8 - 0.4 }));
        break;
      case 'binaural': {
        const merger = this.ctx.createChannelMerger(2);
        [200, 210].forEach((hz, ch) => {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.frequency.value = hz;
          g.gain.value = 0.12;
          osc.connect(g).connect(merger, 0, ch);
          osc.start();
          this.nodes.push(osc, g);
        });
        merger.connect(this.gain);
        this.nodes.push(merger);
        this.source('pink', { filter: 'lowpass', freq: 700, gain: 0.12 });
        break;
      }
      default:
        this.source('pink', { filter: 'lowpass', freq: 1800, gain: 0.6 });
    }
  }

  setVolume(v, fade = 0.4) {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), t, fade / 3);
  }

  destroy() {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.setVolume(0, 0.3);
    setTimeout(() => {
      this.nodes.forEach((n) => { try { n.stop?.(); } catch { /* already stopped */ } try { n.disconnect(); } catch { /* noop */ } });
      this.gain.disconnect();
    }, 500);
  }
}

export class AmbientEngine {
  constructor() {
    this.ctx = null;
    this.layers = new Map();
    this.levels = {};
    this.masterLevel = 0.6;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterLevel;
    this.master.connect(this.ctx.destination);
    this.buffers = { white: noiseBuffer(this.ctx, 'white'), pink: noiseBuffer(this.ctx, 'pink'), brown: noiseBuffer(this.ctx, 'brown') };
  }

  get playing() {
    return this.ctx?.state === 'running' && this.layers.size > 0;
  }

  /** levels: { rain: 0-100, ... } — layers at 0 are removed. */
  async setMix(levels) {
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.levels = { ...levels };
    for (const [id, layer] of this.layers) {
      if (!levels[id]) {
        layer.destroy();
        this.layers.delete(id);
      }
    }
    for (const [id, level] of Object.entries(levels)) {
      if (!level) continue;
      if (!this.layers.has(id)) this.layers.set(id, new Layer(this, id));
      this.layers.get(id).setVolume(level / 100);
    }
  }

  setMaster(volume) {
    this.masterLevel = volume / 100;
    if (this.master) this.master.gain.setTargetAtTime(this.masterLevel, this.ctx.currentTime, 0.1);
  }

  async pause() {
    if (this.ctx?.state === 'running') await this.ctx.suspend();
  }

  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  stop() {
    this.layers.forEach((l) => l.destroy());
    this.layers.clear();
  }

  dispose() {
    this.stop();
    setTimeout(() => this.ctx?.close(), 600);
    this.ctx = null;
  }
}

/** Soft chime used for focus-session transitions. */
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1.5);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* audio unavailable */ }
}
