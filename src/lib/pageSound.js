// A soft paper "swish" for turning a page — synthesised (filtered noise with a rising band and a quick envelope), so no audio file ships.
let ctx = null;
let noise = null;

function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

/** Play one page turn. `strength` 0–1 scales the loudness (a flick is louder than a slow drag). Silent if audio is unavailable. */
export function playPageTurn(strength = 0.6, ms = 420) {
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    if (!noise) {
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime;
    const dur = Math.max(0.18, ms / 1000);
    const src = ac.createBufferSource();
    src.buffer = noise;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(1500, t);
    band.frequency.exponentialRampToValueAtTime(5200, t + dur * 0.7);
    const gain = ac.createGain();
    const peak = 0.05 + 0.16 * Math.max(0, Math.min(1, strength));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(gain).connect(ac.destination);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
  } catch { /* audio is a nicety, never a failure */ }
}
