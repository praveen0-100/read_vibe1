// Annotation styles. They stack: one passage can carry a highlight, an underline and an outline at once.
// Colour NAMES (not hex) are what is stored and synced, so palettes can change without migrating data; every swatch has a
// readable name for assistive technology.

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', name: 'Yellow', value: '#fff176' },
  { id: 'orange', name: 'Peach', value: '#ffcc99' },
  { id: 'green', name: 'Green', value: '#8ff0c3' },
  { id: 'blue', name: 'Blue', value: '#8fe6f0' },
  { id: 'pink', name: 'Pink', value: '#ffc1d6' },
];

export const LINE_COLORS = [
  { id: 'default', name: 'Default', value: 'currentColor' },
  { id: 'grey', name: 'Grey', value: '#6b6b6b' },
  { id: 'red', name: 'Red', value: '#d32f2f' },
  { id: 'orange', name: 'Orange', value: '#ef6c00' },
  { id: 'gold', name: 'Gold', value: '#d4a017' },
  { id: 'green', name: 'Green', value: '#00875a' },
  { id: 'teal', name: 'Teal', value: '#00838f' },
  { id: 'blue', name: 'Blue', value: '#1976d2' },
  { id: 'purple', name: 'Purple', value: '#6a5acd' },
  { id: 'magenta', name: 'Magenta', value: '#c2185b' },
];

export const STYLES = [
  { id: 'highlight', label: 'Highlight', palette: HIGHLIGHT_COLORS },
  { id: 'underline', label: 'Underline', palette: LINE_COLORS },
  { id: 'outline', label: 'Outline', palette: LINE_COLORS },
];

const find = (palette, id) => palette.find((c) => c.id === id);

export const hasMarks = (marks) => !!marks && Object.values(marks).some(Boolean);

/** Inline CSS variables + class names that draw a highlight's stacked styles (see .hl-marked in the stylesheet). */
export function markPresentation(marks) {
  if (!hasMarks(marks)) return null;
  const style = {};
  const classes = ['hl-marked'];
  const bg = find(HIGHLIGHT_COLORS, marks.highlight);
  const ul = find(LINE_COLORS, marks.underline);
  const ol = find(LINE_COLORS, marks.outline);
  if (bg) { style['--m-bg'] = bg.value; classes.push('m-bg'); }
  if (ul) { style['--m-ul'] = ul.value; classes.push('m-ul'); }
  if (ol) { style['--m-ol'] = ol.value; classes.push('m-ol'); }
  return { style, className: classes.join(' ') };
}

/** Human description, e.g. "Blue highlight, Red underline" — used for titles and screen readers. */
export function describeMarks(marks) {
  const out = [];
  const bg = find(HIGHLIGHT_COLORS, marks?.highlight);
  const ul = find(LINE_COLORS, marks?.underline);
  const ol = find(LINE_COLORS, marks?.outline);
  if (bg) out.push(`${bg.name} highlight`);
  if (ul) out.push(`${ul.name} underline`);
  if (ol) out.push(`${ol.name} outline`);
  return out.join(', ');
}

/** Returns new marks with one style changed; a null colour removes that style. */
export function setMark(marks, style, colorId) {
  const next = { ...(marks || {}) };
  if (colorId) next[style] = colorId; else delete next[style];
  return next;
}
