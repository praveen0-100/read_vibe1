// ─── ReadVibe App Root ────────────────────────────────────────────────────────
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './context/AppContext';

// Layout
import Sidebar from './components/layout/Sidebar';

// Pages
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import ReaderPage from './pages/ReaderPage';
import AudioStudioPage from './pages/AudioStudioPage';
import ResearchPage from './pages/ResearchPage';
import NotesPage from './pages/NotesPage';
import SettingsPage from './pages/SettingsPage';

// Overlays
import AIPanel from './components/ai/AIPanel';
import SearchOverlay from './components/search/SearchOverlay';
import UploadModal from './components/upload/UploadModal';
import { Toast, UploadFAB } from './components/ui';

import './styles/global.css';
import './styles/sidebar.css';
import './styles.css';

const PAGE_COMPONENTS = {
  home: HomePage,
  library: LibraryPage,
  reader: ReaderPage,
  audio: AudioStudioPage,
  research: ResearchPage,
  notes: NotesPage,
  settings: SettingsPage,
};

function App() {
  const { state, dispatch } = useApp();
  const { page, theme } = state;

  // Keyboard shortcut: ⌘K for search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        dispatch({ type: 'SET_SEARCH_OPEN', payload: true });
      }
      if (e.key === 'Escape') {
        dispatch({ type: 'SET_SEARCH_OPEN', payload: false });
        dispatch({ type: 'SET_AI_OPEN', payload: false });
        dispatch({ type: 'SET_UPLOAD_OPEN', payload: false });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);

  const PageComponent = PAGE_COMPONENTS[page] || HomePage;

  return (
    <div
      className={`app theme-${theme} ${state.sidebar === 'collapsed' ? 'sidebar-collapsed' : ''}`}
      data-mode={state.readerMode?.toLowerCase()}
    >
      <Sidebar />
      <main className="main" role="main" aria-live="polite">
        <PageComponent />
      </main>

      {/* Global overlays */}
      <AIPanel />
      <SearchOverlay />
      <UploadModal />
      <UploadFAB />
      <Toast />

      {/* Keyboard shortcut hint */}
      <button
        className="search-kbd-hint"
        onClick={() => dispatch({ type: 'SET_SEARCH_OPEN', payload: true })}
        aria-label="Open search (Ctrl+K)"
        title="Search (Ctrl+K)"
      >
        <span>⌘</span>K
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <App />
  </AppProvider>
);
