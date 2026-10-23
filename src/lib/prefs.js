// User preferences: defaults, persistence (localStorage for instant boot, server for sync).

export const DEFAULT_PREFS = {
  theme: 'dark', // dark | light | system
  accent: 'coral', // coral | violet | teal | gold
  reading: {
    font: 'sourcesans', // sourcesans | serif | literata | sans | lexend | hyperlegible | dyslexic
    fontSize: 17,
    lineHeight: 1.42,
    width: 'comfortable', // narrow | comfortable | wide
    paragraphSpacing: 1.1,
    align: 'justify', // left | justify
    paper: 'paper', // white | paper | sepia | night | contrast
    focusLine: false,
    ruler: false,
    brightnessOn: false, // in-app dimming, independent of the device brightness
    brightness: 100, // 30–100
    nightLight: false, // warm filter for evening reading
    pageTurn: 'flip', // flip | slide | fade | none (paged mobile reader)
    styleV: 2, // bumps when the default page style changes, so a one-time migration can run
    bookStyle: 'encyclopedia', // encyclopedia | classic — typography and page furniture of the paged reader
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
    engine: 'natural', // natural (neural voices from the server) | device (the browser's own voices)
    naturalVoice: 'edge:en-US-AvaMultilingualNeural',
    langVoices: {}, // chosen natural voice per language code, e.g. { ta: 'edge:ta-IN-ValluvarNeural' }
    overviewLang: 'ta', // language the Audio Overview opens with (Southern languages first)
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

// The Encyclopedia page style (bold sans, justified, tight rhythm) became the default after some users had already
// saved a reading setup; apply it once to saved settings that predate `styleV` 2.
const ENCYCLOPEDIA = { styleV: 2, bookStyle: 'encyclopedia', font: 'sourcesans', fontSize: 17, lineHeight: 1.42, align: 'justify' };

/** Upgrade a *stored* preferences object (localStorage or the server copy) — never a partial patch from the UI. */
export const upgradePrefs = (p) => (p?.reading && typeof p.reading === 'object' && !(p.reading.styleV >= 2)
  ? { ...p, reading: { ...p.reading, ...ENCYCLOPEDIA } }
  : p);

export const mergePrefs = (...layers) => layers.reduce((acc, l) => deepMerge(acc, l), DEFAULT_PREFS);

export function loadLocalPrefs() {
  try {
    return mergePrefs(upgradePrefs(JSON.parse(localStorage.getItem(KEY) || '{}')));
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
  sourcesans: { label: 'Source Sans', css: "'Source Sans 3', 'Source Sans Pro', Helvetica, Arial, sans-serif" },
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
