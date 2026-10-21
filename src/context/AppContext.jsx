// ─── ReadVibe application state ──────────────────────────────────────────────
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onUnauthorized, tokenStore } from '../api/client';
import { loadLocalPrefs, mergePrefs, resolveTheme, saveLocalPrefs } from '../lib/prefs';

const AppCtx = createContext(null);
let toastSeq = 0;

export function AppProvider({ children }) {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState(tokenStore.get() ? 'loading' : 'anon');

  // ─── Preferences ───────────────────────────────────────────────────────────
  const [prefs, setPrefsState] = useState(loadLocalPrefs);
  const syncTimer = useRef(null);

  const setPrefs = useCallback((patch) => {
    setPrefsState((prev) => {
      const next = mergePrefs(prev, typeof patch === 'function' ? patch(prev) : patch);
      saveLocalPrefs(next);
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        if (tokenStore.get()) api.auth.preferences(next).catch(() => { /* retried on next change */ });
      }, 800);
      return next;
    });
  }, []);

  // ─── Toasts ────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((msg, type = 'success', { action, duration } = {}) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, msg, type, action }]);
    setTimeout(() => dismissToast(id), duration ?? (action ? 6000 : type === 'error' ? 5000 : 3000));
    return id;
  }, [dismissToast]);
  const notifyError = useCallback((err, fallback = 'Something went wrong') => notify(err?.message || fallback, 'error'), [notify]);

  // ─── Confirm dialog ────────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const closeConfirm = useCallback((value) => {
    setConfirmState((s) => { s?.resolve(value); return null; });
  }, []);

  // ─── Overlays ──────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ai, setAI] = useState({ open: false });
  const openAI = useCallback((opts = {}) => setAI({ open: true, tab: 'tools', ...opts }), []);
  const closeAI = useCallback(() => setAI((s) => ({ ...s, open: false })), []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('rv.sidebar') === 'collapsed');
  const toggleSidebar = useCallback(() => setSidebarCollapsed((c) => {
    try { localStorage.setItem('rv.sidebar', c ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
    return !c;
  }), []);

  // ─── Data version: bump to make pages refetch after background changes ─────
  const [dataVersion, setDataVersion] = useState(0);
  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

  // ─── Background jobs & notifications ───────────────────────────────────────
  const [jobs, setJobs] = useState([]);
  const watchers = useRef(new Map());
  const [polling, setPolling] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const list = await api.activity.jobs(false);
      setJobs(list);
      const active = list.filter((j) => j.status === 'queued' || j.status === 'processing');
      for (const [id, cb] of watchers.current) {
        const job = list.find((j) => j.id === id);
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          watchers.current.delete(id);
          cb?.(job);
          refreshData();
        }
      }
      setPolling(active.length > 0 || watchers.current.size > 0);
    } catch { /* offline: try later */ }
  }, [refreshData]);

  const trackJob = useCallback((jobId, onDone) => {
    watchers.current.set(jobId, onDone);
    setPolling(true);
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!polling || authStatus !== 'authed') return undefined;
    const t = setInterval(loadJobs, 1500);
    return () => clearInterval(t);
  }, [polling, loadJobs, authStatus]);

  // ─── Online status ─────────────────────────────────────────────────────────
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ─── Session bootstrap ─────────────────────────────────────────────────────
  const finishLogin = useCallback((res) => {
    tokenStore.set(res.access_token);
    setUser(res.user);
    if (res.user?.preferences && Object.keys(res.user.preferences).length) {
      const merged = mergePrefs(res.user.preferences);
      setPrefsState(merged);
      saveLocalPrefs(merged);
    }
    setAuthStatus('authed');
    loadJobs();
    return res.user;
  }, [loadJobs]);

  const logout = useCallback(() => {
    tokenStore.clear();
    window.google?.accounts?.id?.disableAutoSelect(); // don't silently re-sign-in with Google
    setUser(null);
    setJobs([]);
    setAI({ open: false });
    setAuthStatus('anon');
  }, []);

  useEffect(() => {
    onUnauthorized(() => { setUser(null); setAuthStatus('anon'); });
    if (!tokenStore.get()) return;
    api.auth.me()
      .then((u) => {
        setUser(u);
        if (u.preferences && Object.keys(u.preferences).length) {
          const merged = mergePrefs(loadLocalPrefs(), u.preferences);
          setPrefsState(merged);
          saveLocalPrefs(merged);
        }
        setAuthStatus('authed');
        loadJobs();
      })
      .catch((err) => {
        // Keep the session when merely offline; drop it only when the token is rejected.
        if (err.status === 401) setAuthStatus('anon');
        else { setUser({ name: 'Reader', email: '', offline: true }); setAuthStatus('authed'); }
      });
  }, [loadJobs]);

  const auth = useMemo(() => ({
    login: async (email, password) => finishLogin(await api.auth.login(email, password)),
    register: async (name, email, password) => finishLogin(await api.auth.register(name, email, password)),
    demo: async () => finishLogin(await api.auth.demo()),
    google: async (credential) => finishLogin(await api.auth.google(credential)),
    logout,
  }), [finishLogin, logout]);

  // ─── Apply theme & accessibility to <html> ─────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(prefs.theme);
      root.dataset.accent = prefs.accent;
      root.dataset.motion = prefs.accessibility.reducedMotion ? 'reduced' : 'full';
      root.dataset.contrast = prefs.accessibility.highContrast ? 'high' : 'normal';
      root.dataset.targets = prefs.accessibility.largeTargets ? 'large' : 'normal';
      root.style.fontSize = `${(15 * prefs.accessibility.uiScale) / 100}px`;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.dataset.theme === 'light' ? '#f5f3ef' : '#11100e');
    };
    apply();
    if (prefs.theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme, prefs.accent, prefs.accessibility]);

  const value = {
    user, setUser, authStatus, auth,
    prefs, setPrefs,
    toasts, notify, notifyError, dismissToast,
    confirm, confirmState, closeConfirm,
    searchOpen, setSearchOpen, uploadOpen, setUploadOpen,
    ai, openAI, closeAI,
    sidebarCollapsed, toggleSidebar,
    dataVersion, refreshData,
    jobs, loadJobs, trackJob,
    online,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
