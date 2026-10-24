// ─── Zen mode music ───────────────────────────────────────────────────────────
// Zen plays a fixed, bundled set of songs (src/zen_mode_songs) as one endless shuffled loop.
// The tracks are deliberately never named or listed in the UI — Zen simply has music.
import floats from '../zen_mode_songs/floats-swoop-main-version-48932-05-02.mp3?url';
import homecoming from '../zen_mode_songs/homecoming-tranquilium-main-version-25793-03-28.mp3?url';
import renew from '../zen_mode_songs/renew-tranquilium-main-version-46214-03-28.mp3?url';

const TRACKS = [floats, homecoming, renew];

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class ZenMusic {
  constructor() {
    this.audio = null;
    this.queue = [];
    this.volume = 0.55;
  }

  next() {
    if (!this.queue.length) this.queue = shuffled(TRACKS);
    this.audio.src = this.queue.shift();
    return this.audio.play();
  }

  ensure() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = this.volume;
    this.audio.addEventListener('ended', () => { this.next().catch(() => {}); });
  }

  /** Resolves once playing; rejects if the browser blocks autoplay (the Play button then works). */
  async start() {
    this.ensure();
    if (!this.audio.src) await this.next();
    else await this.audio.play();
  }

  setMaster(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.audio) this.audio.volume = this.volume;
  }

  stop() {
    this.audio?.pause(); // keeps its place, so Play resumes the same song
  }

  dispose() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio = null;
  }
}
