// ─── ReadVibe app root ────────────────────────────────────────────────────────
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Headphones, Plus, Sparkles, Upload, X } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { useClickOutside } from './hooks/useAsync';
import Sidebar, { MobileHeader, MobileNav } from './components/layout/Sidebar';
import MiniReading from './components/layout/MiniReading';
import AIPanel from './components/ai/AIPanel';
import SearchOverlay from './components/search/SearchOverlay';
import UploadModal from './components/upload/UploadModal';
import { ConfirmDialog, PageLoader, Toasts } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import './styles/app.css';
import './styles/mobile.css';
import './styles/responsive.css';
import { installUiScale } from './lib/uiScale';

const HomePage = lazy(() => import('./pages/HomePage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const ReaderPage = lazy(() => import('./pages/ReaderPage'));
const AudioStudioPage = lazy(() => import('./pages/AudioStudioPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const ResearchProjectPage = lazy(() => import('./pages/ResearchProjectPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function QuickActions() {
  const { setUploadOpen, openAI } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const actions = [
    { label: 'Upload document', icon: Upload, run: () => setUploadOpen(true) },
    { label: 'Continue reading', icon: BookOpen, run: () => navigate('/read') },
    { label: 'Generate audio', icon: Headphones, run: () => navigate('/audio?tab=generate') },
    { label: 'Ask AI', icon: Sparkles, run: () => openAI({ tab: 'chat' }) },
  ];
  return (
    <div className={`quick-actions ${open ? 'open' : ''}`} ref={ref}>
      {open && (
        <div className="quick-menu" role="menu">
          {actions.map((a) => (
            <button key={a.label} role="menuitem" onClick={() => { setOpen(false); a.run(); }}>
              <span>{a.label}</span><i><a.icon size={16} /></i>
            </button>
          ))}
        </div>
      )}
      <button className="quick-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close quick actions' : 'Quick actions'} aria-expanded={open}>
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
}

function Shell() {
  const { authStatus, setSearchOpen, setUploadOpen, openAI, closeAI, toggleSidebar, sidebarCollapsed, ai } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const inReader = location.pathname.startsWith('/read');

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
        {!inReader && <MiniReading />}
        {!inReader && <MobileNav />}
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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Root />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
