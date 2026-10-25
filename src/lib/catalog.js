// Free-content sources. Everything here is public domain, openly licensed, or a free public stream:
// Project Gutenberg (via Gutendex), the Internet Archive (pre-1930 texts, LibriVox audiobooks) and the iTunes podcast directory.

import { api } from '../api/client';

const j = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The catalog is unavailable right now (${res.status})`);
  return res.json();
};

export const GENRES = [
  { id: 'fiction', label: 'Novels', topic: 'fiction' },
  { id: 'children', label: 'Story books', topic: 'children' },
  { id: 'adventure', label: 'Adventure', topic: 'adventure' },
  { id: 'mystery', label: 'Mystery', topic: 'detective' },
  { id: 'scifi', label: 'Sci-Fi', topic: 'science fiction' },
  { id: 'romance', label: 'Romance', topic: 'love' },
  { id: 'philosophy', label: 'Philosophy', topic: 'philosophy' },
  { id: 'history', label: 'History', topic: 'history' },
  { id: 'science', label: 'Science', topic: 'science' },
  { id: 'poetry', label: 'Poetry', topic: 'poetry' },
  { id: 'psychology', label: 'Psychology', topic: 'psychology' },
  { id: 'economics', label: 'Economics', topic: 'economics' },
];

const flipName = (n = '') => (n.includes(',') ? n.split(',').reverse().map((s) => s.trim()).join(' ') : n);
const first = (v, fallback) => [].concat(v ?? fallback)[0];

const mapGutenberg = (b) => ({
  source: 'gutenberg', id: String(b.id), rank: b.id, title: b.title,
  author: flipName(b.authors?.[0]?.name) || 'Unknown',
  cover: b.formats?.['image/jpeg'] || null,
  meta: b.download_count ? `${b.download_count.toLocaleString()} downloads` : b.issued ? `Added ${b.issued}` : 'Project Gutenberg',
  tags: (b.subjects || []).slice(0, 3).map((s) => s.split(' -- ')[0]),
  readUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
});

// Gutendex is called through our backend (it rejects browser cross-origin requests) and cached there.
export async function searchGutenberg({ q, topic, page = 1 }) {
  const d = await api.catalog.gutenberg({ q, topic, page });
  return { next: !!d.next, items: d.results.map(mapGutenberg) };
}

const mapLibrivox = (b) => ({
  source: 'librivox', id: b.identifier, rank: Date.parse(b.addeddate || 0) || 0, title: first(b.title), author: first(b.creator, 'LibriVox'),
  cover: `https://archive.org/services/img/${b.identifier}`,
  meta: b.addeddate ? `Added ${new Date(b.addeddate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Audiobook',
});

const mapChartPodcast = (r) => ({
  source: 'podcast', id: String(r.id), rank: 0, title: r.name, author: r.artistName,
  cover: (r.artworkUrl100 || '').replace('100x100', '600x600'), meta: (r.genres?.[0]?.name) || 'Podcast', readUrl: r.url,
});

/** Newest additions across sources (backend-cached for ~15 min). */
export async function fetchFresh() {
  const d = await api.catalog.fresh();
  return {
    ebooks: (d.gutenberg?.results || []).slice(0, 18).map(mapGutenberg),
    audiobooks: (d.librivox?.response?.docs || []).map(mapLibrivox),
    podcasts: (d.podcasts?.feed?.results || []).map(mapChartPodcast),
  };
}

/** Latest episode of each followed show, newest first. */
export async function followedUpdates(shows) {
  const rows = await Promise.all(shows.map(async (s) => {
    try {
      const ep = (await podcastEpisodes(s.id))[0];
      return ep ? { show: s, ep } : null;
    } catch { return null; }
  }));
  return rows.filter(Boolean).sort((a, b) => (b.ep.released || 0) - (a.ep.released || 0));
}

// Texts published before 1930 are public domain in the US; borrow-only lending collections are excluded.
export async function searchArchiveTexts({ q, page = 1 }) {
  const query = `${q ? `(${q}) AND ` : ''}mediatype:texts AND language:eng AND date:[* TO 1929-12-31] AND -collection:(inlibrary OR printdisabled OR lendinglibrary)`;
  const p = new URLSearchParams({ q: query, rows: 24, page, output: 'json', sort: 'downloads desc' });
  ['identifier', 'title', 'creator', 'downloads', 'year'].forEach((f) => p.append('fl[]', f));
  const d = (await j(`https://archive.org/advancedsearch.php?${p}`)).response;
  return {
    next: d.start + d.docs.length < d.numFound,
    items: d.docs.map((b) => ({
      source: 'archive', id: b.identifier, title: first(b.title), author: first(b.creator, 'Unknown'),
      cover: `https://archive.org/services/img/${b.identifier}`,
      meta: [b.year, b.downloads && `${Number(b.downloads).toLocaleString()} views`].filter(Boolean).join(' · '),
      tags: ['Internet Archive'], readUrl: `https://archive.org/details/${b.identifier}`,
    })),
  };
}

// LibriVox audiobooks are public-domain recordings hosted by the Internet Archive.
export async function searchAudiobooks({ q, page = 1 }) {
  const query = `collection:librivoxaudio AND mediatype:audio${q ? ` AND (${q})` : ''}`;
  const p = new URLSearchParams({ q: query, rows: 24, page, output: 'json', sort: 'downloads desc' });
  ['identifier', 'title', 'creator', 'downloads'].forEach((f) => p.append('fl[]', f));
  const d = (await j(`https://archive.org/advancedsearch.php?${p}`)).response;
  return {
    next: d.start + d.docs.length < d.numFound,
    items: d.docs.map((b) => ({
      source: 'librivox', id: b.identifier, title: first(b.title), author: first(b.creator, 'LibriVox'),
      cover: `https://archive.org/services/img/${b.identifier}`,
      meta: b.downloads ? `${Number(b.downloads).toLocaleString()} plays` : 'Audiobook',
    })),
  };
}

export async function audiobookTracks(identifier) {
  const d = await j(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const mp3 = (d.files || []).filter((f) => /mp3/i.test(f.format || ''));
  const vbr = mp3.filter((f) => /VBR MP3/i.test(f.format));
  const picked = [...(vbr.length ? vbr : mp3)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return picked.map((f, i) => ({
    title: f.title || f.name.replace(/\.mp3$/i, '').replace(/_/g, ' ') || `Part ${i + 1}`,
    url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`,
    seconds: parseFloat(f.length) || 0,
  }));
}

export async function searchPodcasts({ q }) {
  const p = new URLSearchParams({ term: q || 'books', media: 'podcast', entity: 'podcast', limit: 24 });
  const d = await j(`https://itunes.apple.com/search?${p}`);
  return {
    next: false,
    items: d.results.map((r) => ({
      source: 'podcast', id: String(r.collectionId), title: r.collectionName, author: r.artistName,
      cover: r.artworkUrl600 || r.artworkUrl100, meta: r.primaryGenreName, readUrl: r.collectionViewUrl,
    })),
  };
}

export async function podcastEpisodes(id) {
  const d = await j(`https://itunes.apple.com/lookup?id=${id}&media=podcast&entity=podcastEpisode&limit=25`);
  return d.results.filter((r) => r.kind === 'podcast-episode' && r.episodeUrl).map((r) => ({
    title: r.trackName, url: r.episodeUrl, seconds: (r.trackTimeMillis || 0) / 1000, released: Date.parse(r.releaseDate || 0) || 0,
  }));
}

// Free courses, archives and reference sites (links only).
export const RESOURCES = [
  { group: 'Free university courses', items: [
    { name: 'Open Yale Courses', url: 'https://oyc.yale.edu/', note: 'Full Yale lectures, free' },
    { name: 'Yale — Game Theory (Ben Polak)', url: 'https://oyc.yale.edu/economics/econ-159', note: 'Economics' },
    { name: 'Yale — Introduction to Psychology (Paul Bloom)', url: 'https://oyc.yale.edu/psychology/psyc-110', note: 'Psychology' },
    { name: 'MIT OpenCourseWare', url: 'https://ocw.mit.edu/', note: 'Thousands of MIT courses' },
    { name: 'MIT — Economic Applications of Game Theory', url: 'https://ocw.mit.edu/courses/14-12-economic-applications-of-game-theory-fall-2012/', note: 'Economics' },
    { name: 'MIT — Psychology and Economics', url: 'https://ocw.mit.edu/courses/14-13-psychology-and-economics-fall-2021/', note: 'Behavioral economics' },
  ] },
  { group: 'Libraries & archives', items: [
    { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/', note: '70,000+ public-domain books' },
    { name: 'Internet Archive', url: 'https://archive.org/', note: 'Books, audio, video, web archive' },
    { name: 'Google Scholar', url: 'https://scholar.google.com/', note: 'Papers and citations' },
    { name: 'Open Library', url: 'https://openlibrary.org/', note: 'Catalog of every edition' },
    { name: 'LibriVox', url: 'https://librivox.org/', note: 'Free public-domain audiobooks' },
  ] },
  { group: 'Reference wikis & essays', items: [
    { name: 'LessWrong', url: 'https://www.lesswrong.com/', note: 'Rationality community' },
    { name: 'Farnam Street', url: 'https://fs.blog/', note: 'Mental models' },
    { name: 'Astral Codex Ten', url: 'https://www.astralcodexten.com/', note: 'Essays' },
    { name: 'List of cognitive biases', url: 'https://en.wikipedia.org/wiki/List_of_cognitive_biases', note: 'Wikipedia' },
  ] },
  { group: 'AI assistants', items: [
    { name: 'Duck.ai', url: 'https://duck.ai/', note: 'Private AI chat (opens in a new tab)' },
  ] },
];
