// Moods re-colour the whole app (surfaces, glow, accent) from two hues, so the interface can match how the reader feels.
// `h` is the hue of the surfaces, `a` the hue of the accent; the stylesheet (styles/studio.css) turns them into the palette.
// "auto" follows the time of day: gentle in the morning, sharp through the working day, warm in the evening, dim at night.
import { Coffee, Flower2, Leaf, Moon, Palette, Sunrise, Target, Waves, Zap } from 'lucide-react';

export const MOODS = [
  { id: 'auto', label: 'Auto', blurb: 'Follows the time of day', icon: Sunrise },
  { id: 'classic', label: 'Classic', blurb: 'The original ReadVibe look', icon: Palette, h: 24, a: 17 },
  { id: 'calm', label: 'Calm', blurb: 'Soft sage and mist for easy reading', icon: Leaf, h: 165, a: 162 },
  { id: 'focus', label: 'Focus', blurb: 'Cool indigo that keeps you on the page', icon: Target, h: 228, a: 232 },
  { id: 'cozy', label: 'Cozy', blurb: 'Warm amber, like a lamp and a blanket', icon: Coffee, h: 30, a: 34 },
  { id: 'energize', label: 'Energise', blurb: 'Bright coral-pink for a lively session', icon: Zap, h: 348, a: 352 },
  { id: 'ocean', label: 'Ocean', blurb: 'Clear blue, unhurried and open', icon: Waves, h: 199, a: 196 },
  { id: 'bloom', label: 'Bloom', blurb: 'Orchid and rose for creative work', icon: Flower2, h: 318, a: 322 },
  { id: 'night', label: 'Night', blurb: 'Deep violet for late hours', icon: Moon, h: 262, a: 266 },
];

export const MOOD_IDS = new Set(MOODS.map((m) => m.id));

/** Which mood "auto" means at a given moment. */
export function autoMood(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 10) return 'calm';
  if (hour >= 10 && hour < 17) return 'focus';
  if (hour >= 17 && hour < 21) return 'cozy';
  return 'night';
}

/** The concrete mood id to paint with (never "auto"). */
export function resolveMood(mood, date = new Date()) {
  if (mood === 'auto') return autoMood(date);
  return MOOD_IDS.has(mood) ? mood : 'classic';
}

export const moodById = (id) => MOODS.find((m) => m.id === id) || MOODS[1];

/** Two CSS colours that sum a mood up, for swatches. */
export function moodSwatch(id, light = false) {
  const m = moodById(id === 'auto' ? autoMood() : id);
  const h = m.h ?? 24;
  const a = m.a ?? 17;
  return light
    ? [`hsl(${h} 38% 94%)`, `hsl(${a} 62% 48%)`]
    : [`hsl(${h} 20% 9%)`, `hsl(${a} 72% 64%)`];
}
