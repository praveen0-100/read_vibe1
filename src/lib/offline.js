// ─── Offline library (IndexedDB) ─────────────────────────────────────────────
// Stores complete reading packages (chapters, highlights, bookmarks) so documents
// stay readable without a connection.

const DB_NAME = 'readvibe-offline';
const STORE = 'documents';
let dbPromise = null;

function open() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Offline storage is not supported in this browser'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const offline = {
  async save(pkg) {
    const record = { id: pkg.document.id, savedAt: new Date().toISOString(), ...pkg };
    await tx('readwrite', (s) => s.put(record));
    return record;
  },
  async get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async list() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
  async usage() {
    const items = await offline.list().catch(() => []);
    const bytes = items.reduce((sum, i) => sum + JSON.stringify(i).length * 2, 0);
    let quota = null;
    try {
      const est = await navigator.storage?.estimate?.();
      quota = est?.quota ?? null;
    } catch { /* not supported */ }
    return { count: items.length, bytes, quota };
  },
};
