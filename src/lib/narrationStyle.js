// How the narrator SOUNDS, chosen by the listener: a tone (calm, energetic, dramatic …) and a pitch. A tone is a delivery recipe the
// server already understands — pace, energy, articulation and a base emotion (see backend services/tts.PRESETS and speechplan).
// Everything the app asks the voice to say passes through `withStyle`, so one setting changes the read-aloud, the previews and the
// audio overview alike. Stage directions in the text ("[in fright]") still win over the base emotion.

export const TONES = [
  { id: 'natural', label: 'Natural', hint: 'Human and varied — the default', natural: true },
  { id: 'calm', label: 'Calm', hint: 'Slow, soft, soothing', pace: 'relaxed', energy: 'low', articulation: 'balanced', emotion: 'gentle', natural: true },
  { id: 'warm', label: 'Storyteller', hint: 'Warm, unhurried, like a bedtime book', pace: 'relaxed', energy: 'moderate', articulation: 'balanced', emotion: 'warm', natural: true },
  { id: 'news', label: 'News anchor', hint: 'Crisp and steady', pace: 'conversational', energy: 'moderate', articulation: 'precise', emotion: 'serious', natural: false },
  { id: 'energetic', label: 'Energetic', hint: 'Quick, bright, upbeat', pace: 'brisk', energy: 'high', articulation: 'casual', emotion: 'excited', natural: true },
  { id: 'cheerful', label: 'Cheerful', hint: 'Light and playful', pace: 'conversational', energy: 'high', articulation: 'casual', emotion: 'playful', natural: true },
  { id: 'dramatic', label: 'Dramatic', hint: 'Deliberate, weighty, theatrical', pace: 'slow', energy: 'high', articulation: 'precise', emotion: 'solemn', natural: true },
  { id: 'serious', label: 'Serious', hint: 'Grave and focused', pace: 'conversational', energy: 'low', articulation: 'precise', emotion: 'serious', natural: false },
  { id: 'whisper', label: 'Whisper', hint: 'Hushed, for the late night', pace: 'slow', energy: 'low', articulation: 'balanced', emotion: 'whisper', natural: false },
];

const BY_ID = Object.fromEntries(TONES.map((t) => [t.id, t]));
const state = { tone: 'natural', pitch: 0 };

/** Called whenever the audio preferences change. */
export function setNarrationStyle(audio = {}) {
  state.tone = BY_ID[audio.narrationTone] ? audio.narrationTone : 'natural';
  state.pitch = Math.max(-10, Math.min(10, Number(audio.pitch) || 0));
}

export const narrationStyle = () => ({ ...state });

/** Part of every clip's cache key: a different tone or pitch is a different recording. */
export const styleKey = () => `${state.tone}:${state.pitch}`;

/** The delivery for one line: the text's own direction first, then the listener's tone and pitch. */
export function withStyle(delivery) {
  const t = BY_ID[state.tone];
  const own = delivery?.emotion && delivery.emotion !== 'neutral' ? delivery.emotion : null;
  return {
    ...delivery,
    emotion: own || t.emotion || delivery?.emotion,
    shift: (delivery?.shift || 0) + state.pitch,
    pace: delivery?.pace ?? t.pace,
    energy: delivery?.energy ?? t.energy,
    articulation: delivery?.articulation ?? t.articulation,
    natural: delivery?.natural ?? t.natural,
  };
}
