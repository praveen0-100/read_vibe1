import { describe, expect, it } from 'vitest';
import { TONES, setNarrationStyle, styleKey, withStyle } from '../lib/narrationStyle';
import { splitText } from '../lib/translateClient';

describe('narration tone', () => {
  it('has a distinct recipe for every tone and falls back to natural', () => {
    expect(new Set(TONES.map((t) => t.id)).size).toBe(TONES.length);
    setNarrationStyle({ narrationTone: 'nonsense', pitch: 99 });
    expect(styleKey()).toBe('natural:10'); // unknown tone → natural, pitch clamped to ±10
  });

  it('applies the tone and pitch, but a stage direction in the text still wins', () => {
    setNarrationStyle({ narrationTone: 'dramatic', pitch: -4 });
    const plain = withStyle({ emotion: 'neutral', shift: 0 });
    expect(plain).toMatchObject({ emotion: 'solemn', pace: 'slow', energy: 'high', shift: -4 });
    const directed = withStyle({ emotion: 'fright', shift: 3 });
    expect(directed.emotion).toBe('fright');
    expect(directed.shift).toBe(-1); // the character's own pitch shift plus the listener's
  });

  it('changes the clip cache key when the tone changes, so old recordings are never replayed', () => {
    setNarrationStyle({ narrationTone: 'calm', pitch: 0 });
    const a = styleKey();
    setNarrationStyle({ narrationTone: 'energetic', pitch: 0 });
    expect(styleKey()).not.toBe(a);
  });
});

describe('translation chunking', () => {
  it('cuts long text at sentence ends, never above the limit, losing nothing', () => {
    const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const parts = splitText(text, 400);
    expect(parts.every((p) => p.length <= 400)).toBe(true);
    expect(parts.join(' ')).toBe(text);
    expect(parts.slice(0, -1).every((p) => p.endsWith('.'))).toBe(true);
  });
});
