import { withStyle } from '../lib/narrationStyle';

// ─── ReadVibe API client ──────────────────────────────────────────────────────
// Thin, typed-error wrapper around fetch. Every request carries the JWT; a 401
// clears the session and notifies the app so it can route to the login screen.

// Deployed builds talk to the API host directly: the Vercel rewrite adds a hop and gives up before a sleeping free-tier
// API has finished waking. Local dev keeps the same-origin `/api` proxy from vite.config.js.
const DEPLOYED_API = 'https://readvibe-api.onrender.com/api';
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
export const API_BASE = (import.meta.env.VITE_API_URL || (import.meta.env.PROD && !isLocalHost ? DEPLOYED_API : '/api')).replace(/\/$/, '');
const TOKEN_KEY = 'rv.token';

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
  get isNetwork() { return this.status === 0; }
}

let unauthorizedHandler = null;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

// ─── Server wake-up status ────────────────────────────────────────────────────
// Free hosting puts the API to sleep when idle; the first request can take ~30 s. While we retry, the UI can say so.
let waking = false;
const wakeListeners = new Set();
const setWaking = (v) => { if (v !== waking) { waking = v; wakeListeners.forEach((fn) => fn(v)); } };
export const isWaking = () => waking;
export const onWaking = (fn) => { wakeListeners.add(fn); return () => wakeListeners.delete(fn); };

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});
const RETRY_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS = [1200, 2500, 4000, 6000, 8000, 10000]; // ≈ 32 s of patience in total
const ATTEMPT_TIMEOUT = 25000;

/** Ask the API to wake up ahead of time (called as soon as the app loads). */
let warmPromise = null;
export const warmUp = () => (warmPromise ||= request('/health', { retry: true }).then(() => true, () => { warmPromise = null; return false; }));

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { invalidateCache(); try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

function authHeaders(extra = {}) {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

async function parseError(res) {
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  const detail = data?.detail;
  const message = typeof detail === 'string' ? detail
    : res.status === 429 ? 'Too many requests — please wait a moment.'
    : res.status >= 500 ? 'The server had a problem. Please try again.'
    : res.status === 405 ? 'The ReadVibe API route is not configured correctly. Redeploy the app with its API server connected.'
    : res.status === 404 ? 'The ReadVibe API endpoint was not found. Check that the deployed app is connected to the correct API server.'
    : `Request failed (${res.status})`;
  return new ApiError(message, res.status, data);
}

export async function request(path, { method = 'GET', body, query, signal, raw = false, retry, headers: extraHeaders } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v));
  const isForm = body instanceof FormData;
  // Reads, and the sign-in calls (the server never processed them if it was still asleep), are safe to retry.
  const canRetry = retry ?? (method === 'GET' || path.startsWith('/auth/'));
  let res;
  for (let attempt = 0; ; attempt++) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), isForm || path.includes('/export') ? 0x7fffffff : ATTEMPT_TIMEOUT * (canRetry ? 1 : 3));
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let failure = null;
    try {
      res = await fetch(url, {
        method,
        signal: timeout.signal,
        headers: authHeaders({ ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }),
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
      if (!RETRY_STATUS.has(res.status)) { setWaking(false); break; }
      failure = res;
    } catch (err) {
      if (signal?.aborted) throw err; // the caller cancelled — not a failure
      failure = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (!canRetry || attempt >= RETRY_DELAYS.length) {
      setWaking(false);
      if (failure instanceof Response) { res = failure; break; }
      throw new ApiError('The ReadVibe server isn’t responding right now. It may be waking up — please try again in a few seconds.', 0);
    }
    setWaking(true);
    await sleep(RETRY_DELAYS[attempt], signal);
  }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/google') {
    tokenStore.clear();
    unauthorizedHandler?.();
  }
  if (!res.ok) throw await parseError(res);
  if (raw) return res;
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

/** Upload with progress events (fetch has no upload progress). */
export function upload(path, formData, onProgress, method = 'POST') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE}${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      invalidateCache();
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.detail || `Upload failed (${xhr.status})`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — the server is unreachable.', 0));
    xhr.send(formData);
  });
}

/** A protected binary (cover art) as a Blob — <img> tags cannot send the auth header themselves. */
export async function fetchBlob(path) {
  const res = await request(path, { raw: true });
  return res.blob();
}

/** Download a protected file and hand it to the browser as a save. */
export async function download(path, { method = 'GET', body, filename } = {}) {
  const res = await request(path, { method, body, raw: true });
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const name = filename || (match ? match[1] : 'download');
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** URL for media elements that cannot send headers (token in the query string). */
export const mediaUrl = (path) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(tokenStore.get() || '')}`;

// ─── Endpoints ────────────────────────────────────────────────────────────────
// Reads are de-duplicated while in flight and kept for a few seconds, so two components asking for the same list
// (or a quick back-and-forth between pages) cost one round trip. Any write clears the cache.
const READ_TTL = 15000;
const NO_CACHE = /^\/(jobs|health|auth|tts|ai|agent)(\/|$|\?)/;
const reads = new Map(); // key -> { at, promise }
export const invalidateCache = () => reads.clear();

const get = (p, query, opts) => {
  if (opts?.signal || opts?.raw || NO_CACHE.test(p)) return request(p, { query, ...opts });
  const key = p + JSON.stringify(query || {});
  const hit = reads.get(key);
  if (hit && Date.now() - hit.at < READ_TTL) return hit.promise.then((d) => (d && typeof d === 'object' ? structuredClone(d) : d));
  const promise = request(p, { query, ...opts });
  reads.set(key, { at: Date.now(), promise });
  promise.catch(() => reads.delete(key));
  return promise.then((d) => (d && typeof d === 'object' ? structuredClone(d) : d));
};
const write = (method) => (p, body, opts) => { invalidateCache(); return request(p, { method, body, ...opts }); };

/** Same request within the same 15 s window => same key, so a double-click or a retry never starts a second generation job. */
const idempotencyKey = (scope, body) => {
  let h = 5381;
  const text = `${scope}|${JSON.stringify(body)}|${Math.floor(Date.now() / 15000)}`;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `rv-${h.toString(36)}-${text.length}`;
};
const postOnce = (scope) => (p, body) => post(p, body, { headers: { 'Idempotency-Key': idempotencyKey(scope + p, body) } });
const post = write('POST');
const put = write('PUT');
const patch = write('PATCH');
const del = (p) => { invalidateCache(); return request(p, { method: 'DELETE' }); };

export const api = {
  health: () => get('/health'),

  auth: {
    login: (email, password) => post('/auth/login', { email, password }),
    verifyMfa: (mfa_token, code) => post('/auth/2fa/verify', { mfa_token, code }),
    security: () => get('/auth/security'),
    mfaSetup: () => post('/auth/2fa/setup'),
    mfaEnable: (code) => post('/auth/2fa/enable', { code }),
    mfaDisable: (code, password) => post('/auth/2fa/disable', { code, password }),
    register: (name, email, password) => post('/auth/register', { name, email, password }),
    demo: () => post('/auth/demo'),
    config: () => get('/auth/config'),
    google: (credential) => post('/auth/google', { credential }),
    me: () => get('/auth/me'),
    update: (data) => patch('/auth/me', data),
    preferences: (preferences) => put('/auth/me/preferences', { preferences }),
    changePassword: (current_password, new_password) => post('/auth/me/password', { current_password, new_password }),
    exportData: () => download('/auth/me/export'),
    deleteAccount: () => del('/auth/me'),
  },

  catalog: {
    gutenberg: (query) => get('/catalog/gutenberg', query),
    fresh: () => get('/catalog/new'),
  },

  documents: {
    list: (query) => get('/documents', query),
    tags: () => get('/documents/tags'),
    recommendations: () => get('/documents/recommendations'),
    get: (id) => get(`/documents/${id}`),
    upload: (file, onProgress) => {
      const fd = new FormData();
      fd.append('file', file);
      return upload('/documents/upload', fd, onProgress);
    },
    createText: (data) => post('/documents/text', data),
    importCatalog: (data) => post('/catalog/import', data),
    update: (id, data) => patch(`/documents/${id}`, data),
    remove: (id) => del(`/documents/${id}`),
    open: (id) => post(`/documents/${id}/open`),
    chapter: (id, index) => get(`/documents/${id}/chapters/${index}`),
    package: (id) => get(`/documents/${id}/package`),
    downloadFile: (id) => download(`/documents/${id}/file`),
    render: (id) => get(`/documents/${id}/render`),
    exportHighlights: (id, format) => download(`/documents/${id}/highlights/export?format=${format}`),
    report: (id, data) => post(`/documents/${id}/reports`, data),
    outline: (id) => get(`/documents/${id}/outline`),
    setCover: (id, file) => { const fd = new FormData(); fd.append('file', file, file.name || 'cover'); return upload(`/documents/${id}/cover`, fd, undefined, 'PUT'); },
    removeCover: (id) => del(`/documents/${id}/cover`),
    progress: (id, data) => put(`/documents/${id}/progress`, data),
    search: (id, q) => get(`/documents/${id}/search`, { q }),
    highlights: (id) => get(`/documents/${id}/highlights`),
    addHighlight: (id, data) => post(`/documents/${id}/highlights`, data),
    updateHighlight: (hid, data) => patch(`/documents/highlights/${hid}`, data),
    removeHighlight: (hid) => del(`/documents/highlights/${hid}`),
    sketches: (id, chapter) => get(`/documents/${id}/sketches`, { chapter }),
    addSketch: (id, data) => post(`/documents/${id}/sketches`, data),
    removeSketch: (sid) => del(`/documents/sketches/${sid}`),
    clearSketches: (id, chapter) => del(`/documents/${id}/sketches?chapter=${chapter}`),
    bookmarks: (id) => get(`/documents/${id}/bookmarks`),
    addBookmark: (id, data) => post(`/documents/${id}/bookmarks`, data),
    removeBookmark: (bid) => del(`/documents/bookmarks/${bid}`),
  },

  notes: {
    list: (query) => get('/notes', query),
    notebook: () => get('/notes/notebook'),
    create: (data) => post('/notes', data),
    update: (id, data) => patch(`/notes/${id}`, data),
    remove: (id) => del(`/notes/${id}`),
    exportMarkdown: () => download('/notes/export/markdown'),
  },

  ai: {
    overview: (data) => post('/ai/overview', data),
    translate: (texts, target, source = 'en') => post('/ai/translate', { texts, target, source }),
    status: () => get('/ai/status'),
    test: () => post('/ai/test', {}),
    summarize: (document_id, chapter_index, depth) => post('/ai/summarize', { document_id, chapter_index, depth }),
    explain: (text, mode, document_id) => post('/ai/explain', { text, mode, document_id }),
    define: (term, document_id) => post('/ai/define', { term, document_id }),
    chat: (data) => post('/ai/chat', data),
    mindmap: (document_id, chapter_index) => post('/ai/mindmap', { document_id, chapter_index }),
    diagram: (data) => post('/ai/diagram', data),
    quiz: (document_id, chapter_index, count = 6) => post('/ai/quiz', { document_id, chapter_index, count }),
    grade: (answer, reference) => post('/ai/quiz/grade', { answer, reference }),
    compare: (data) => post('/ai/compare', data),
    visual: (query) => post('/ai/visual', { query }),
    recommendations: () => get('/ai/recommendations'),
  },

  tts: {
    status: () => get('/tts/status'),
    voices: () => get('/tts/voices'),
    synthesize: (text, voice, raw) => { const delivery = withStyle(raw); return post('/tts/synthesize', { text, voice, emotion: delivery?.emotion, pitch_shift: delivery?.shift || 0, pace: delivery?.pace, energy: delivery?.energy, articulation: delivery?.articulation, language: delivery?.language, glossary: delivery?.glossary, natural: delivery?.natural, position: delivery?.position }); },
    languages: () => get('/tts/languages'),
    cast: (docId, names) => post(`/documents/${docId}/cast`, { names }),
  },

  decks: {
    list: () => get('/decks'),
    get: (id) => get(`/decks/${id}`),
    ask: (id, data) => post(`/decks/${id}/ask`, data),
    /** From a library document. */
    create: (data) => postOnce('deck')('/decks', data),
    /** From any readable file (TXT, MD, DOCX, PDF, XML, HTML, EPUB, PPTX…), without adding it to the library. */
    upload: (file, opts, onProgress) => {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(opts).forEach(([k, v]) => fd.append(k, String(v)));
      return upload('/decks/upload', fd, onProgress);
    },
    update: (id, data) => patch(`/decks/${id}`, data),
    remove: (id) => del(`/decks/${id}`),
    exportPptx: (id) => download(`/decks/${id}/export.pptx`),
  },

  audio: {
    tones: () => get('/audio/tones'),
    preview: (tone, text) => post('/audio/preview', { tone, text }),
    list: () => get('/audio/audiobooks'),
    create: (data) => postOnce('audio')('/audio/audiobooks', data),
    get: (id) => get(`/audio/audiobooks/${id}`),
    update: (id, data) => patch(`/audio/audiobooks/${id}`, data),
    remove: (id) => del(`/audio/audiobooks/${id}`),
    downloadScript: (id) => download(`/audio/audiobooks/${id}/script.txt`),
    collab: {
      list: () => get('/audio/collab'),
      create: (data) => post('/audio/collab', data),
      update: (id, data) => patch(`/audio/collab/${id}`, data),
      remove: (id) => del(`/audio/collab/${id}`),
      upload: (id, assignmentId, blob, seconds, onProgress) => {
        const fd = new FormData();
        fd.append('assignment_id', assignmentId);
        fd.append('duration_seconds', String(seconds || 0));
        fd.append('file', blob, `take.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
        return upload(`/audio/collab/${id}/recordings`, fd, onProgress);
      },
      recordingUrl: (id, rid) => mediaUrl(`/audio/collab/${id}/recordings/${rid}`),
      fetchRecording: (id, rid) => request(`/audio/collab/${id}/recordings/${rid}`, { raw: true }).then((r) => r.arrayBuffer()),
      removeRecording: (id, rid) => del(`/audio/collab/${id}/recordings/${rid}`),
    },
  },

  research: {
    list: () => get('/research'),
    create: (data) => post('/research', data),
    get: (id) => get(`/research/${id}`),
    update: (id, data) => patch(`/research/${id}`, data),
    remove: (id) => del(`/research/${id}`),
    discover: (id, query, limit = 15) => post(`/research/${id}/discover`, { query, limit }),
    addReferences: (id, items) => post(`/research/${id}/references`, items),
    updateReference: (id, rid, data) => patch(`/research/${id}/references/${rid}`, data),
    removeReference: (id, rid) => del(`/research/${id}/references/${rid}`),
    citations: (id, style) => get(`/research/${id}/citations`, { style }),
    outline: (id) => post(`/research/${id}/outline`),
    draft: (id, key, action) => post(`/research/${id}/sections/${key}`, { action }),
    editSection: (id, key, content) => put(`/research/${id}/sections/${key}`, { content }),
    restore: (id, key, version) => post(`/research/${id}/sections/${key}/restore/${version}`),
    review: (id) => get(`/research/${id}/review`),
    export: (id, format) => download(`/research/${id}/export`, { method: 'POST', body: { format } }),
  },

  transcribe: {
    status: () => get('/transcribe/status'),
    /** A recording → a background job whose result is the transcript (and, with `save`, a library document). */
    start: (file, opts, onProgress) => {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(opts).forEach(([k, v]) => v !== '' && v != null && fd.append(k, String(v)));
      return upload('/transcribe', fd, onProgress);
    },
    /** A short voice clip → text straight away. */
    dictate: (blob, ext = 'webm') => {
      const fd = new FormData();
      fd.append('file', blob, `clip.${ext}`);
      return upload('/transcribe/dictate', fd);
    },
  },

  agent: {
    status: () => get('/agent/status'),
    chat: (data) => request('/agent/chat', { method: 'POST', body: { tz_offset: new Date().getTimezoneOffset(), ...data } }),
    briefing: () => get('/agent/briefing', { tz_offset: new Date().getTimezoneOffset() }),
    profile: () => get('/agent/profile', { tz_offset: new Date().getTimezoneOffset() }),
    checkin: (mood) => request('/agent/checkin', { method: 'POST', body: { mood, tz_offset: new Date().getTimezoneOffset() } }),
    /** Fire-and-forget signal (quiz result, answer feedback); never blocks or surfaces an error. */
    event: (kind, payload, document_id) => request('/agent/events', { method: 'POST', body: { kind, payload, document_id } }).catch(() => {}),
    settings: (data) => request('/agent/settings', { method: 'PUT', body: data }),
    forget: (id) => request(`/agent/memories/${id}`, { method: 'DELETE' }),
    forgetAll: () => request('/agent/memories', { method: 'DELETE' }),
  },

  goals: {
    progress: (tz_offset) => get('/goals/progress', { tz_offset }),
    get: () => get('/goals'),
    set: (data) => put('/goals', data),
  },
  collections: {
    list: () => get('/collections'),
    create: (data) => post('/collections', data),
    update: (id, data) => patch(`/collections/${id}`, data),
    remove: (id) => del(`/collections/${id}`),
    add: (id, document_id) => post(`/collections/${id}/documents`, { document_id }),
    removeDoc: (id, documentId) => del(`/collections/${id}/documents/${documentId}`),
  },
  shares: {
    list: () => get('/shares'),
    create: (data) => post('/shares', data),
    revoke: (id) => del(`/shares/${id}`),
    view: (token) => get(`/shared/${encodeURIComponent(token)}`),
  },
  study: {
    exportCards: (format) => download(`/study/export?format=${format}`),
    queue: (params) => get('/study/queue', params),
    stats: () => get('/study/stats'),
    review: (id, grade) => post(`/study/cards/${id}/review`, { grade }),
    create: (data) => post('/study/cards', data),
    fromHighlights: (document_id) => post('/study/from-highlights', { document_id, count: 40 }),
    fromDocument: (document_id, count = 10) => post('/study/from-document', { document_id, count }),
    suspend: (id) => patch(`/study/cards/${id}`, { suspended: true }),
    remove: (id) => del(`/study/cards/${id}`),
  },
  playback: {
    state: () => get('/playback/state'),
    saveState: (body) => put('/playback/state', body),
  },
  lookup: (term, lang = 'en', context = '') => get('/lookup', { term, lang, ...(context ? { context } : {}) }),
  research_verify: (data) => post('/research/verify', data),
  research_graph: (data) => post('/research/graph', data),
  sources: {
    artifacts: (documentId) => get(`/sources/${documentId}/artifacts`),
  },
  activity: {
    logSession: (data) => post('/sessions', data),
    stats: () => get('/stats', { tz_offset: new Date().getTimezoneOffset() }),
    search: (q, signal) => get('/search', { q }, { signal }),
    jobs: (active) => get('/jobs', { active }),
    cancelJob: (id) => post(`/jobs/${id}/cancel`),
    retryJob: (id) => post(`/jobs/${id}/retry`),
    job: (id) => get(`/jobs/${id}`),
    markSeen: () => post('/jobs/mark-seen'),
    clearJobs: () => del('/jobs'),
  },
};
