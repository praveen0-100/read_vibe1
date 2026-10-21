import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data-fetching hook: runs `fn` when deps change, exposes loading/error,
 * a `reload()` that keeps stale data visible, and `setData` for optimistic updates.
 */
export function useQuery(fn, deps = [], { enabled = true, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === seq.current) setData(result);
      return result;
    } catch (err) {
      if (id === seq.current && err?.name !== 'AbortError') setError(err);
      return undefined;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) run();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, error, loading, reload: run, setData };
}

/** Wraps an async action with pending state and error capture. */
export function useAction(fn) {
  const [pending, setPending] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...args) => {
    setPending(true);
    try {
      return await fnRef.current(...args);
    } finally {
      setPending(false);
    }
  }, []);
  return [run, pending];
}

export function useDebounce(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useInterval(fn, delay) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (delay == null) return undefined;
    const t = setInterval(() => ref.current(), delay);
    return () => clearInterval(t);
  }, [delay]);
}

export function useClickOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const listener = (e) => {
      if (ref.current && !ref.current.contains(e.target)) handler(e);
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, [ref, handler, active]);
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
