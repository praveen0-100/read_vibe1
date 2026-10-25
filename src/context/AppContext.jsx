// ─── ReadVibe application state ──────────────────────────────────────────────
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onUnauthorized, tokenStore } from '../api/client';
import { loadLocalPrefs, mergePrefs, resolveTheme, saveLocalPrefs, upgradePrefs } from '../lib/prefs';

const AppCtx = createContext(null);
const USER_KEY = 'rv.user';
// The last signed-in profile is kept so a returning reader sees the app at once instead of a spinner while a sleeping server wakes.
const cachedUser = () => { try { return tokenStore.get() ? JSON.parse(localStorage.getItem(USER_KEY)) : null; } catch { return null; } };
const DEMO_KEY = 'rv.demo';
const isDemoSession = () => { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } };
const markDemo = (on) => { try { on ? localStorage.setItem(DEMO_KEY, '1') : localStorage.removeItem(DEMO_KEY); } catch { /* storage unavailable */ } };
const cacheUser = (u) => { try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch { /* storage unavailable */ } };
let toastSeq = 0;

export function AppProvider({ children }) {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(cachedUser);
  const [authStatus, setAuthStatus] = useState(() => (!tokenStore.get() ? 'anon' : cachedUser() ? 'authed' : 'loading'));

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
    cacheUser(res.user);
    setUser(res.user);
    if (res.user?.preferences && Object.keys(res.user.preferences).length) {
      const merged = mergePrefs(upgradePrefs(res.user.preferences));
      setPrefsState(merged);
      saveLocalPrefs(merged);
    }
    setAuthStatus('authed');
    loadJobs();
    return res.user;
  }, [loadJobs]);

  const logout = useCallback(() => {
    markDemo(false);
    tokenStore.clear();
    cacheUser(null);
    window.google?.accounts?.id?.disableAutoSelect(); // don't silently re-sign-in with Google
    setUser(null);
    setJobs([]);
    setAI({ open: false });
    setAuthStatus('anon');
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      cacheUser(null);
      // The hosted API's database can be reset on a restart, which invalidates old tokens. A demo session has no
      // credentials to lose, so quietly open a fresh one instead of bouncing the visitor to the login page.
      if (isDemoSession()) {
        api.auth.demo().then((res) => finishLogin(res)).catch(() => { setUser(null); setAuthStatus('anon'); });
        return;
      }
      setUser(null);
      setAuthStatus('anon');
    });
    if (!tokenStore.get()) return;
    api.auth.me()
      .then((u) => {
        cacheUser(u);
        setUser(u);
        if (u.preferences && Object.keys(u.preferences).length) {
          const merged = mergePrefs(loadLocalPrefs(), upgradePrefs(u.preferences));
          setPrefsState(merged);
          saveLocalPrefs(merged);
        }
        setAuthStatus('authed');
        loadJobs();
      })
      .catch((err) => {
        // Keep the session when merely offline; drop it only when the token is rejected.
        if (err.status === 401) { if (!isDemoSession()) { cacheUser(null); setAuthStatus('anon'); } }
        else { setUser((u) => u || { name: 'Reader', email: '', offline: true }); setAuthStatus('authed'); }
      });
  }, [loadJobs, finishLogin]);

  const auth = useMemo(() => ({
    login: async (email, password) => { markDemo(false); return finishLogin(await api.auth.login(email, password)); },
    register: async (name, email, password) => { markDemo(false); return finishLogin(await api.auth.register(name, email, password)); },
    demo: async () => { const res = await api.auth.demo(); markDemo(true); return finishLogin(res); },
    google: async (credential) => { markDemo(false); return finishLogin(await api.auth.google(credential)); },
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
