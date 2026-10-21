// ─── Audiobook stitching ─────────────────────────────────────────────────────
// Decodes each recorded part, trims silence, applies a gentle noise gate,
// peak-normalises, joins with short gaps and encodes a single WAV file.

const TARGET_PEAK = 0.89; // ≈ -1 dBFS
const GAP_SECONDS = 1.2;

function trimSilence(data, sampleRate, threshold = 0.015) {
  const win = Math.floor(sampleRate * 0.02);
  let start = 0;
  let end = data.length;
  for (let i = 0; i < data.length; i += win) {
    if (Math.abs(data[i]) > threshold) { start = Math.max(0, i - win * 5); break; }
  }
  for (let i = data.length - 1; i > start; i -= win) {
    if (Math.abs(data[i]) > threshold) { end = Math.min(data.length, i + win * 10); break; }
  }
  return data.subarray(start, end);
}

function noiseGate(data, sampleRate, floor = 0.01) {
  const win = Math.floor(sampleRate * 0.03);
  const out = new Float32Array(data.length);
  let gain = 1;
  for (let i = 0; i < data.length; i += win) {
    let rms = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) rms += data[j] * data[j];
    rms = Math.sqrt(rms / (end - i));
    const target = rms < floor ? 0.15 : 1;
    for (let j = i; j < end; j++) {
      gain += (target - gain) * 0.002; // smooth to avoid clicks
      out[j] = data[j] * gain;
    }
  }
  return out;
}

function normalise(data) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (!peak) return data;
  const g = Math.min(8, TARGET_PEAK / peak);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] * g;
  return out;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * @param {ArrayBuffer[]} parts recorded audio files in order
 * @param {{cleanup?: boolean, onProgress?: (n:number)=>void}} opts
 */
export async function stitch(parts, { cleanup = true, onProgress } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const sampleRate = 44100;
  const chunks = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const decoded = await ctx.decodeAudioData(parts[i].slice(0));
      // downmix + resample via OfflineAudioContext
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
      const src = offlineCtx.createBufferSource();
      src.buffer = decoded;
      src.connect(offlineCtx.destination);
      src.start();
      const rendered = await offlineCtx.startRendering();
      let data = rendered.getChannelData(0);
      if (cleanup) {
        data = trimSilence(data, sampleRate);
        data = noiseGate(data, sampleRate);
      }
      chunks.push(normalise(data));
      onProgress?.(Math.round(((i + 1) / parts.length) * 90));
    }
  } finally {
    ctx.close();
  }
  const gap = new Float32Array(Math.floor(GAP_SECONDS * sampleRate));
  const total = chunks.reduce((n, c) => n + c.length, 0) + gap.length * Math.max(0, chunks.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  chunks.forEach((c, i) => {
    out.set(c, offset);
    offset += c.length + (i < chunks.length - 1 ? gap.length : 0);
  });
  onProgress?.(100);
  return { blob: encodeWav(out, sampleRate), seconds: total / sampleRate };
}
