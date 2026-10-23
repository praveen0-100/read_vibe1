// ─── ReadVibe app root ────────────────────────────────────────────────────────
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar, { MobileHeader, MobileNav } from './components/layout/Sidebar';
import MiniReading from './components/layout/MiniReading';
import QuickActions from './components/layout/QuickActions';
import AIPanel from './components/ai/AIPanel';
import SearchOverlay from './components/search/SearchOverlay';
import UploadModal from './components/upload/UploadModal';
import { ConfirmDialog, PageLoader, Toasts } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import './styles/app.css';
import './styles/mobile.css';
import './styles/overview.css';
import './styles/indic.css';
import './styles/responsive.css';
import { installUiScale } from './lib/uiScale';
import { warmUp } from './api/client';

const HomePage = lazy(() => import('./pages/HomePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const ReaderPage = lazy(() => import('./pages/ReaderPage'));
const AudioStudioPage = lazy(() => import('./pages/AudioStudioPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const ResearchProjectPage = lazy(() => import('./pages/ResearchProjectPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function Shell() {
  const { authStatus, setSearchOpen, setUploadOpen, openAI, closeAI, toggleSidebar, sidebarCollapsed, ai } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const inReader = location.pathname.startsWith('/read');

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
      <AIPanel />
      <SearchOverlay />
      <UploadModal />
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
