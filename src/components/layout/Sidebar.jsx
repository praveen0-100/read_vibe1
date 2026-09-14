// ─── Sidebar Navigation ───────────────────────────────────────────────────────
import React from 'react';
import { Home, Library, BookOpen, Brain, FileText, Settings, Sparkles, MoreHorizontal, Moon, Sun, Headphones, Menu } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'reader', label: 'Read now', icon: BookOpen, dot: true },
  { id: 'audio', label: 'Audio Studio', icon: Headphones },
  { id: 'research', label: 'Research', icon: Brain },
  { id: 'notes', label: 'Notebook', icon: FileText },
];

export default function Sidebar() {
  const { state, dispatch, setPage } = useApp();
  const { page, theme, sidebar } = state;
  const collapsed = sidebar === 'collapsed';

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <button
          className="brand"
          onClick={() => setPage('home')}
          aria-label="ReadVibe Home"
        >
          <div className="brand-mark">
            <Sparkles size={14} />
          </div>
          {!collapsed && <span>read<em>vibe</em></span>}
        </button>
        <button
          className="collapse-btn"
          onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
      </div>

      {!collapsed && <div className="workspace-label">WORKSPACE</div>}

      <nav className="sidebar-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon, dot }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
            aria-current={page === id ? 'page' : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
            {dot && <span className="live-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button
          className={`nav-item ${page === 'settings' ? 'active' : ''}`}
          onClick={() => setPage('settings')}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={18} />
          {!collapsed && <span>Settings</span>}
        </button>

        {!collapsed && (
          <div className="profile-mini">
            <div className="avatar" aria-label="User avatar">PS</div>
            <div className="profile-info">
              <strong>Praveen S.</strong>
              <small>Personal space</small>
            </div>
            <MoreHorizontal size={15} className="muted-icon" />
          </div>
        )}

        <button
          className="theme-switch"
          onClick={() => dispatch({ type: 'SET_THEME', payload: theme === 'dark' ? 'light' : 'dark' })}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={collapsed ? 'Toggle theme' : undefined}
        >
          {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
          {!collapsed && (
            <>
              <span className="theme-label">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
              <span className="switch" aria-hidden="true">
                <i className={theme === 'dark' ? 'on' : ''} />
              </span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
