// ─── ReadVibe API client ──────────────────────────────────────────────────────
// Thin, typed-error wrapper around fetch. Every request carries the JWT; a 401
// clears the session and notifies the app so it can route to the login screen.

export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
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

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
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
    : `Request failed (${res.status})`;
  return new ApiError(message, res.status, data);
}

export async function request(path, { method = 'GET', body, query, signal, raw = false } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v));
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: authHeaders(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Can’t reach the ReadVibe server. Check that the API is running and you are online.', 0);
  }
  if (res.status === 401 && path !== '/auth/login') {
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
export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.detail || `Upload failed (${xhr.status})`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — the server is unreachable.', 0));
    xhr.send(formData);
  });
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
const get = (p, query, opts) => request(p, { query, ...opts });
const post = (p, body) => request(p, { method: 'POST', body });
const put = (p, body) => request(p, { method: 'PUT', body });
const patch = (p, body) => request(p, { method: 'PATCH', body });
const del = (p) => request(p, { method: 'DELETE' });

export const api = {
  health: () => get('/health'),

  auth: {
    login: (email, password) => post('/auth/login', { email, password }),
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

  documents: {
    list: (query) => get('/documents', query),
    tags: () => get('/documents/tags'),
    get: (id) => get(`/documents/${id}`),
    upload: (file, onProgress) => {
      const fd = new FormData();
      fd.append('file', file);
      return upload('/documents/upload', fd, onProgress);
    },
    createText: (data) => post('/documents/text', data),
    update: (id, data) => patch(`/documents/${id}`, data),
    remove: (id) => del(`/documents/${id}`),
    open: (id) => post(`/documents/${id}/open`),
    chapter: (id, index) => get(`/documents/${id}/chapters/${index}`),
    package: (id) => get(`/documents/${id}/package`),
    downloadFile: (id) => download(`/documents/${id}/file`),
    progress: (id, data) => put(`/documents/${id}/progress`, data),
    search: (id, q) => get(`/documents/${id}/search`, { q }),
    highlights: (id) => get(`/documents/${id}/highlights`),
    addHighlight: (id, data) => post(`/documents/${id}/highlights`, data),
    updateHighlight: (hid, data) => patch(`/documents/highlights/${hid}`, data),
    removeHighlight: (hid) => del(`/documents/highlights/${hid}`),
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
    status: () => get('/ai/status'),
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

  audio: {
    tones: () => get('/audio/tones'),
    preview: (tone, text) => post('/audio/preview', { tone, text }),
    list: () => get('/audio/audiobooks'),
    create: (data) => post('/audio/audiobooks', data),
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

  activity: {
    logSession: (data) => post('/sessions', data),
    stats: () => get('/stats', { tz_offset: new Date().getTimezoneOffset() }),
    search: (q, signal) => get('/search', { q }, { signal }),
    jobs: (active) => get('/jobs', { active }),
    job: (id) => get(`/jobs/${id}`),
    markSeen: () => post('/jobs/mark-seen'),
    clearJobs: () => del('/jobs'),
  },
};
