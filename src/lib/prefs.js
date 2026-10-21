// User preferences: defaults, persistence (localStorage for instant boot, server for sync).

export const DEFAULT_PREFS = {
  theme: 'dark', // dark | light | system
  accent: 'coral', // coral | violet | teal | gold
  reading: {
    font: 'serif', // serif | literata | sans | lexend | hyperlegible | dyslexic
    fontSize: 18,
    lineHeight: 1.75,
    width: 'comfortable', // narrow | comfortable | wide
    paragraphSpacing: 1.1,
    align: 'left', // left | justify
    paper: 'paper', // paper | sepia | night | contrast
    focusLine: false,
    ruler: false,
  },
  accessibility: {
    reducedMotion: false,
    highContrast: false,
    largeTargets: false,
    uiScale: 100,
  },
  audio: {
    rate: 1,
    tone: 'Regular',
    voice: '',
    sleepTimer: 0,
    autoAdvance: true,
  },
  zen: { preset: 'rainy_library', volume: 55, focusMinutes: 25, breakMinutes: 5, mix: { rain: 70 } },
  vibe: { preset: 'midnight', volume: 60, contrast: 85, intensity: 70, savedCombos: [] },
  notifications: { jobs: true, focusEnd: true },
};

const KEY = 'rv.prefs';

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

export const mergePrefs = (...layers) => layers.reduce((acc, l) => deepMerge(acc, l), DEFAULT_PREFS);

export function loadLocalPrefs() {
  try {
    return mergePrefs(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveLocalPrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable */ }
}

export const READING_FONTS = {
  serif: { label: 'Playfair', css: "'Playfair Display', Georgia, serif" },
  literata: { label: 'Literata', css: "'Literata', Georgia, serif" },
  sans: { label: 'DM Sans', css: "'DM Sans', system-ui, sans-serif" },
  lexend: { label: 'Lexend', css: "'Lexend', system-ui, sans-serif" },
  hyperlegible: { label: 'Hyperlegible', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  dyslexic: { label: 'OpenDyslexic', css: "'OpenDyslexic', 'Lexend', system-ui, sans-serif" },
};

export const READING_WIDTHS = { narrow: '34rem', comfortable: '42rem', wide: '52rem' };

export function resolveTheme(theme) {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return theme;
}
