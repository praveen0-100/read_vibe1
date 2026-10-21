// Immersive backdrops for Zen and Vibe modes.
import React, { useEffect, useRef } from 'react';

export const ZEN_PRESETS = [
  { id: 'rainy_library', name: 'Rainy Library', emoji: '🌧', mix: { rain: 70 }, palette: 'dusk' },
  { id: 'deep_forest', name: 'Deep Forest', emoji: '🌲', mix: { forest: 75, rain: 15 }, palette: 'forest' },
  { id: 'night_study', name: 'Night Study', emoji: '🌙', mix: { binaural: 55, white: 20 }, palette: 'night' },
  { id: 'minimal_white', name: 'Minimal White', emoji: '◻', mix: {}, palette: 'paper' },
  { id: 'ocean_focus', name: 'Ocean Focus', emoji: '🌊', mix: { ocean: 75 }, palette: 'ocean' },
  { id: 'coffeehouse', name: 'Quiet Coffeehouse', emoji: '☕', mix: { cafe: 70, rain: 10 }, palette: 'ember' },
  { id: 'fireside', name: 'Fireside', emoji: '🔥', mix: { fire: 70, rain: 20 }, palette: 'ember' },
];

export const VIBE_PRESETS = [
  { id: 'midnight', name: 'Midnight', emoji: '🌙', hue: 'cyan', station: 'lofi' },
  { id: 'chill', name: 'Chill', emoji: '🌿', hue: 'mint', station: 'lofi' },
  { id: 'study', name: 'Study', emoji: '📚', hue: 'indigo', station: 'lofi' },
  { id: 'rainy', name: 'Rainy', emoji: '🌧', hue: 'steel', station: 'dream' },
  { id: 'cinematic', name: 'Cinematic', emoji: '🎬', hue: 'amber', station: 'dream' },
  { id: 'dreamy', name: 'Dreamy', emoji: '✨', hue: 'violet', station: 'dream' },
  { id: 'energetic', name: 'Energetic', emoji: '⚡', hue: 'magenta', station: 'pulse' },
  { id: 'lofi', name: 'Lo-Fi Focus', emoji: '🎵', hue: 'sunset', station: 'lofi' },
];

export function ZenBackdrop({ palette = 'dusk', intensity = 1 }) {
  return (
    <div className={`zen-backdrop zen-${palette}`} aria-hidden="true" style={{ '--zen-motion': intensity }}>
      <div className="zen-sun" />
      <div className="zen-mountain zen-mountain-back" />
      <div className="zen-mountain zen-mountain-front" />
      <div className="zen-tree"><span /><i /><b /></div>
      <div className="zen-water"><div className="zen-waterline" /><div className="zen-waves" /></div>
      <div className="zen-mist" />
      {palette === 'dusk' || palette === 'night' ? <div className="zen-rain" /> : null}
    </div>
  );
}

const COLUMNS = 48;
const SEGMENTS = 18;
const IDLE = [7, 10, 13, 18, 25, 33, 42, 56, 72, 88, 62, 44, 31, 22, 35, 49, 63, 52, 37, 25, 19, 28, 41, 57, 76, 92, 68, 47, 34, 24, 40, 55, 71, 48, 30, 21, 29, 43, 59, 77, 94, 69, 51, 36, 26, 39, 58, 78];

/** Equalizer that follows the real audio when `getLevels` returns data, and idles otherwise. */
export function VibeVisualizer({ playing, getLevels, hue = 'cyan', intensity = 70 }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const cols = ref.current ? [...ref.current.querySelectorAll('.vibe-column')] : [];
    const tick = () => {
      const levels = getLevels?.(COLUMNS);
      cols.forEach((col, i) => {
        const v = levels ? 6 + levels[i] * 94 * (0.5 + intensity / 200) : IDLE[i];
        col.style.setProperty('--column-height', `${Math.min(100, v)}%`);
      });
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    else cols.forEach((col, i) => col.style.setProperty('--column-height', `${IDLE[i] * 0.45}%`));
    return () => cancelAnimationFrame(raf);
  }, [playing, getLevels, intensity]);

  return (
    <div className={`vibe-equalizer hue-${hue} ${playing ? 'is-playing' : 'is-paused'}`} aria-hidden="true" style={{ '--vibe-intensity': intensity / 100 }}>
      <div className="vibe-equalizer-glow" />
      <div className="vibe-equalizer-grid" ref={ref}>
        {IDLE.map((h, index) => (
          <div className="vibe-column" key={index} style={{ '--column-height': `${h}%`, '--column-delay': `${(index % 9) * -0.13}s` }}>
            {Array.from({ length: SEGMENTS }, (_, s) => <i key={s} className={s > 14 ? 'hot' : s > 10 ? 'pink' : ''} />)}
          </div>
        ))}
      </div>
      <div className="vibe-reflection" />
    </div>
  );
}
