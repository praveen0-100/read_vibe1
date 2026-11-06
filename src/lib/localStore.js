// Tiny persisted external store (localStorage + cross-tab sync) usable from React via `use()`.
import { useSyncExternalStore } from 'react';

export function createStore(key, initial) {
  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch { return initial; }
  };
  let state = read();
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());

  const get = () => state;
  const set = (next) => {
    const value = typeof next === "function" ? next(state) : next;
    if (value === state) return; // nothing changed: no write, no re-render, no sync
    state = value;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* private mode / quota */ }
    emit();
  };
  const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
  window.addEventListener('storage', (e) => { if (e.key === key) { state = read(); emit(); } });

  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get) };
}
