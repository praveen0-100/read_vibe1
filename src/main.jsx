// ─── ReadVibe app root ────────────────────────────────────────────────────────
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar, { MobileHeader, MobileNav } from './components/layout/Sidebar';
import MiniReading from './components/layout/MiniReading';
import QuickActions from './components/layout/QuickActions';
import { ConfirmDialog, PageLoader, Toasts } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import LegalPage from './pages/LegalPage';
import './styles/app.css';
import './styles/mobile.css';
import './styles/overview.css';
import './styles/album.css';
import './styles/indic.css';
import './styles/responsive.css';
import './styles/refresh.css';
import './styles/discover.css';
import { installUiScale } from './lib/uiScale';
import { warmUp } from './api/client';

// Panels that only exist once opened stay out of the first download; they are fetched in the background once the app is idle.
const loadAIPanel = () => import('./components/ai/AIPanel');
const loadSearch = () => import('./components/search/SearchOverlay');
const loadUpload = () => import('./components/upload/UploadModal');
const AIPanel = lazy(loadAIPanel);
const SearchOverlay = lazy(loadSearch);
const UploadModal = lazy(loadUpload);

const loaders = {
  home: () => import('./pages/HomePage'),
  discover: () => import('./pages/DiscoverPage'),
  library: () => import('./pages/LibraryPage'),
  reader: () => import('./pages/ReaderPage'),
  audio: () => import('./pages/AudioStudioPage'),
};
const HomePage = lazy(loaders.home);
const LibraryPage = lazy(loaders.library);
const ReaderPage = lazy(loaders.reader);
const AudioStudioPage = lazy(loaders.audio);
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const ResearchProjectPage = lazy(() => import('./pages/ResearchProjectPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DiscoverPage = lazy(loaders.discover);
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

/** Mounts its children the first time `open` becomes true and keeps them mounted afterwards (so closing can animate). */
function OnFirstOpen({ open, children }) {
  const seen = useRef(false);
  if (open) seen.current = true;
  return seen.current ? <Suspense fallback={null}>{children}</Suspense> : null;
}

/** Warm the chunks the user is most likely to need next, without competing with the first render. */
function usePrefetch(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (navigator.connection?.saveData) return undefined;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      [loaders.discover, loaders.library, loaders.reader, loaders.audio, loadSearch, loadUpload, loadAIPanel].forEach((load, i) => setTimeout(load, i * 400));
    }, { timeout: 4000 });
    return () => cancel(id);
  }, [enabled]);
}

function Shell() {
  const { authStatus, searchOpen, setSearchOpen, uploadOpen, setUploadOpen, openAI, closeAI, toggleSidebar, sidebarCollapsed, ai } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const inReader = location.pathname.startsWith('/read');
  usePrefetch(authStatus === 'authed');

  // The phone dock (mini player stacked on the tab bar) is one box; its measured height becomes --dock-h so every page can
  // reserve exactly that much room at its end and toasts sit just above it.
  const [dock, setDock] = useState(null); // a state-backed ref: the dock only exists once signed in, so measure the moment it attaches
  useEffect(() => {
    const el = dock;
    const root = document.documentElement;
    if (!el) { root.style.removeProperty('--dock-h'); return undefined; }
    const publish = () => root.style.setProperty('--dock-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--dock-h'); };
  }, [dock]);

  // The scroll container persists across routes, so start each page at the top.
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === '[') toggleSidebar();
      if (e.key === 'u' && !inReader) setUploadOpen(true);
      if (e.key === 'a' && !inReader) (ai.open ? closeAI() : openAI());
      if (e.key === 'g') {
        const next = (ev) => {
          const map = { h: '/', l: '/library', r: '/read', a: '/audio', s: '/research', n: '/notes', ',': '/settings' };
          if (map[ev.key]) navigate(map[ev.key]);
        };
        window.addEventListener('keydown', next, { once: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen, setUploadOpen, openAI, closeAI, toggleSidebar, navigate, inReader, ai.open]);

  if (authStatus === 'loading') return <div className="boot"><PageLoader label="Opening your library…" /></div>;
  if (authStatus === 'anon') return <Navigate to="/login" replace state={{ from: location }} />;

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${inReader ? 'in-reader' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar />
      <div className="main-col">
        {!inReader && <MobileHeader />}
        <main className="main" id="main">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route index element={<HomePage />} />
                <Route path="discover" element={<DiscoverPage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="read" element={<ReaderPage />} />
                <Route path="read/:docId" element={<ReaderPage />} />
                <Route path="audio" element={<AudioStudioPage />} />
                <Route path="research" element={<ResearchPage />} />
                <Route path="research/:projectId" element={<ResearchProjectPage />} />
                <Route path="notes" element={<NotesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
        {!inReader && (
          <div className="dock" ref={setDock}>
            <MiniReading />
            <MobileNav />
          </div>
        )}
      </div>
      <OnFirstOpen open={ai.open}><AIPanel /></OnFirstOpen>
      <OnFirstOpen open={searchOpen}><SearchOverlay /></OnFirstOpen>
      <OnFirstOpen open={uploadOpen}><UploadModal /></OnFirstOpen>
      {!inReader && <QuickActions />}
    </div>
  );
}

function Root() {
  const { authStatus } = useApp();
  return (
    <>
      <Routes>
        <Route path="/login" element={authStatus === 'authed' ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
      <Toasts />
      <ConfirmDialog />
    </>
  );
}

installUiScale();
warmUp(); // start waking a sleeping API while the app itself loads

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Root />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
