// Cover artwork as object URLs. <img> cannot send the Authorization header, so covers are fetched with the API client
// and cached per document; a changed cover bumps its version so every <img> showing it refreshes.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchBlob } from '../api/client';

const urls = new Map();      // docId -> object URL
const pending = new Map();   // docId -> Promise
const missing = new Set();   // docId confirmed to have no readable cover (avoid refetching on every render)
const subs = new Set();
let version = 0;
const emit = () => { version += 1; subs.forEach((f) => f()); };

export function loadCover(docId) {
  if (!docId) return Promise.resolve(null);
  if (urls.has(docId)) return Promise.resolve(urls.get(docId));
  if (missing.has(docId)) return Promise.resolve(null);
  if (!pending.has(docId)) {
    pending.set(docId, fetchBlob(`/documents/${docId}/cover`)
      .then((blob) => { const u = URL.createObjectURL(blob); urls.set(docId, u); return u; })
      .catch(() => { missing.add(docId); return null; })
      .finally(() => pending.delete(docId)));
  }
  return pending.get(docId);
}

/** Forget a document's cached cover (after upload / removal) and tell mounted images to reload. */
export function invalidateCover(docId) {
  const u = urls.get(docId);
  if (u) URL.revokeObjectURL(u);
  urls.delete(docId); missing.delete(docId); pending.delete(docId);
  emit();
}

/** The object URL for a document's cover, or null while loading / when it has none (callers keep their generated art underneath). */
export function useCoverUrl(docId) {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  const [url, setUrl] = useState(() => (docId ? urls.get(docId) ?? null : null));
  useEffect(() => {
    let live = true;
    if (!docId) { setUrl(null); return undefined; }
    loadCover(docId).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [docId, v]);
  return docId ? url : null;
}
