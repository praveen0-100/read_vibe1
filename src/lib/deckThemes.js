// Presentation themes and small helpers shared by the editor, the slideshow and the presenter view.
// The colours mirror backend/app/services/art.py (THEMES) so the generated pictures, the web slides and the exported .pptx match.
import { API_BASE } from '../api/client';

export const DECK_THEMES = {
  aurora: { name: 'Aurora', bg0: '#06121f', bg1: '#0d2a3a', a1: '#2de2c4', a2: '#7c5cff', a3: '#5ab8ff', text: '#eaf6ff', muted: '#8fb2c7', panel: '#0f2433' },
  nebula: { name: 'Nebula', bg0: '#0c0818', bg1: '#241046', a1: '#ff5fd2', a2: '#8b6bff', a3: '#ffb86b', text: '#f6efff', muted: '#b7a6d6', panel: '#1a1032' },
  solar: { name: 'Solar', bg0: '#150a06', bg1: '#3a1a0c', a1: '#ffb347', a2: '#ff6b4a', a3: '#ffe08a', text: '#fff4e8', muted: '#d1a98c', panel: '#26120a' },
  frost: { name: 'Frost', bg0: '#f4f8fc', bg1: '#dbe8f5', a1: '#1769e0', a2: '#7b4dff', a3: '#00a6a6', text: '#0e1b2c', muted: '#51647a', panel: '#ffffff' },
};
export const THEME_KEYS = Object.keys(DECK_THEMES);

/** High-contrast override for presenters who need it: pure ink on pure ground, strong accents. */
const HIGH_CONTRAST = { bg0: '#000000', bg1: '#000000', a1: '#ffe600', a2: '#00e5ff', a3: '#ff9bff', text: '#ffffff', muted: '#e6e6e6', panel: '#111111' };

export const themeVars = (theme, highContrast = false) => {
  const t = { ...(DECK_THEMES[theme] || DECK_THEMES.aurora), ...(highContrast ? HIGH_CONTRAST : null) };
  return { '--dk-bg0': t.bg0, '--dk-bg1': t.bg1, '--dk-a1': t.a1, '--dk-a2': t.a2, '--dk-a3': t.a3, '--dk-text': t.text, '--dk-muted': t.muted, '--dk-panel': t.panel };
};

export const ART_STYLES = ['orbit', 'network', 'wave', 'crystal'];
export const ANIMATIONS = [['fade', 'Fade'], ['rise', 'Rise'], ['zoom', 'Zoom'], ['slide', 'Slide in'], ['draw', 'Draw']];
export const TRANSITIONS = [['fade', 'Fade'], ['push', 'Push'], ['zoom', 'Zoom']];
export const LAYOUT_LABEL = {
  title: 'Title', agenda: 'Agenda', concept: 'Concept', bullets: 'Bullets', hierarchy: 'Hierarchy', types: 'Categories', process: 'Flowchart',
  chart: 'Chart', mindmap: 'Mind map', compare: 'Comparison', timeline: 'Timeline', stats: 'Key figures', quote: 'Quote', summary: 'Summary',
};

/** URL of a slide's generated picture (served by the API, cached by the browser). */
export const artSrc = (image, theme, w = 960, h = 540) => (!image ? null
  : `${API_BASE}/decks/art/image?${new URLSearchParams({ seed: image.seed || 'idea', theme: theme || 'aurora', style: image.style || '', w, h })}`);

/** How many click-to-reveal "builds" a slide has (0 = it appears whole). */
export function buildCount(slide) {
  const d = slide.data || {};
  switch (slide.layout) {
    case 'concept': case 'bullets': case 'agenda': case 'summary': return slide.bullets?.length || 0;
    case 'process': return d.nodes?.length || 0;
    case 'types': case 'compare': return d.columns?.length || 0;
    case 'timeline': return d.events?.length || 0;
    case 'stats': return d.items?.length || 0;
    case 'mindmap': return d.branches?.length || 0;
    case 'hierarchy': return d.root?.children?.length || 0;
    default: return 0;
  }
}

export const newSlide = () => ({
  id: Math.random().toString(36).slice(2, 10), layout: 'bullets', title: 'New slide', subtitle: '', bullets: ['First point', 'Second point'],
  notes: '', alt: 'New slide.', anim: 'rise', transition: 'fade', data: {}, image: { seed: 'new idea', style: '' },
});
