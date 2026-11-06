import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, LINE_COLORS, describeMarks, hasMarks, markPresentation, setMark } from '../lib/annotations';

describe('annotation marks', () => {
  it('styles stack on the same text', () => {
    let marks = {};
    marks = setMark(marks, 'highlight', 'blue');
    marks = setMark(marks, 'underline', 'red');
    marks = setMark(marks, 'outline', 'default');
    expect(marks).toEqual({ highlight: 'blue', underline: 'red', outline: 'default' });
    const p = markPresentation(marks);
    expect(p.className).toBe('hl-marked m-bg m-ul m-ol');
    expect(p.style).toMatchObject({ '--m-bg': '#8fe6f0', '--m-ul': '#d32f2f' });
  });

  it('None removes just that style and leaves the others', () => {
    const marks = setMark({ highlight: 'yellow', underline: 'teal' }, 'highlight', null);
    expect(marks).toEqual({ underline: 'teal' });
    expect(hasMarks(setMark(marks, 'underline', null))).toBe(false);
  });

  it('does not mutate the previous marks (safe for React state)', () => {
    const before = { highlight: 'green' };
    setMark(before, 'highlight', 'pink');
    expect(before).toEqual({ highlight: 'green' });
  });

  it('has no presentation without marks, and names every colour for screen readers', () => {
    expect(markPresentation({})).toBeNull();
    expect(markPresentation({ underline: null })).toBeNull();
    expect(describeMarks({ highlight: 'orange', outline: 'gold' })).toBe('Peach highlight, Gold outline');
    for (const c of [...HIGHLIGHT_COLORS, ...LINE_COLORS]) expect(c.name).toBeTruthy();
  });

  it('palette ids match what the API accepts', () => {
    expect(HIGHLIGHT_COLORS.map((c) => c.id)).toEqual(['yellow', 'orange', 'green', 'blue', 'pink']);
    expect(LINE_COLORS.map((c) => c.id)).toEqual(['default', 'grey', 'red', 'orange', 'gold', 'green', 'teal', 'blue', 'purple', 'magenta']);
  });
});
