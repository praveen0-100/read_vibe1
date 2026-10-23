// ─── Sidebar & mobile navigation ─────────────────────────────────────────────
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpen, Brain, FileText, Headphones, Home, Library, LogOut, Menu as MenuIcon, Moon,
  Search, Settings, Sparkles, Sun, User, WifiOff,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { initials } from '../../lib/format';
import { resolveTheme } from '../../lib/prefs';
import { Menu } from '../ui';
import Notifications from './Notifications';
import QuickActions from './QuickActions';

export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/read', label: 'Read now', icon: BookOpen, dot: true },
  { to: '/audio', label: 'Audio Studio', icon: Headphones },
  { to: '/research', label: 'Research', icon: Brain },
  { to: '/notes', label: 'Notebook', icon: FileText },
];

export default function Sidebar() {
  const { user, prefs, setPrefs, sidebarCollapsed: collapsed, toggleSidebar, setSearchOpen, auth, online, confirm } = useApp();
  const navigate = useNavigate();
  const dark = resolveTheme(prefs.theme) === 'dark';

  const signOut = async () => {
    if (await confirm({ title: 'Sign out?', message: 'Documents saved for offline reading stay on this device.', confirmLabel: 'Sign out' })) {
      auth.logout();
      navigate('/login');
    }
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary">
      <div className="sidebar-top">
        <NavLink to="/" className="brand" aria-label="ReadVibe home">
          <span className="brand-mark"><Sparkles size={14} /></span>
          {!collapsed && <span className="brand-name">read<em>vibe</em></span>}
        </NavLink>
        <button className="collapse-btn" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar ([)">
          <MenuIcon size={16} />
        </button>
      </div>

      <button className="sidebar-search" onClick={() => setSearchOpen(true)} title="Search (Ctrl+K)">
        <Search size={15} />
        {!collapsed && <><span>Search</span><kbd>Ctrl K</kbd></>}
      </button>

      {!collapsed && <div className="workspace-label">WORKSPACE</div>}
      <nav className="sidebar-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, dot }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={collapsed ? label : undefined}>
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
            {dot && !collapsed && <span className="live-dot" aria-hidden="true" />}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {!online && (
          <div className="offline-pill" title="You are offline — saved documents still work">
            <WifiOff size={14} /> {!collapsed && 'Offline mode'}
          </div>
        )}
        <div className="sidebar-row">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={collapsed ? 'Settings' : undefined}>
            <Settings size={18} />
            {!collapsed && <span>Settings</span>}
          </NavLink>
          {!collapsed && <Notifications />}
        </div>

        <div className="profile-mini">
          {user?.avatar_url
            ? <img className="avatar" src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
            : <div className="avatar" aria-hidden="true">{initials(user?.name)}</div>}
          {!collapsed && (
            <>
              <div className="profile-info">
                <strong>{user?.name || 'Reader'}</strong>
                <small>{user?.email || 'Personal space'}</small>
              </div>
              <Menu label="Account menu" trigger={<span className="icon-ghost sm">⋯</span>} align="up" items={[
                { label: 'Account settings', icon: User, onClick: () => navigate('/settings?tab=account') },
                { label: dark ? 'Light mode' : 'Dark mode', icon: dark ? Sun : Moon, onClick: () => setPrefs({ theme: dark ? 'light' : 'dark' }) },
                '-',
                { label: 'Sign out', icon: LogOut, onClick: signOut, danger: true },
              ]} />
            </>
          )}
        </div>

        <button className="theme-switch" onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
          aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title="Toggle theme">
          {dark ? <Moon size={15} /> : <Sun size={15} />}
          {!collapsed && (
            <>
              <span className="theme-label">{dark ? 'Dark mode' : 'Light mode'}</span>
              <span className={`switch ${dark ? 'on' : ''}`} aria-hidden="true"><i /></span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { setSearchOpen } = useApp();
  const items = [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2], NAV_ITEMS[3]];
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon size={22} />
          <span>{label === 'Read now' ? 'Read' : label === 'Audio Studio' ? 'Audio' : label}</span>
        </NavLink>
      ))}
      <button type="button" className="nav-search" onClick={() => setSearchOpen(true)}>
        <Search size={22} />
        <span>Search</span>
      </button>
    </nav>
  );
}

export function MobileHeader() {
  const { setSearchOpen, user } = useApp();
  return (
    <header className="mobile-header">
      <NavLink to="/" className="brand" aria-label="ReadVibe home">
        <span className="brand-mark"><Sparkles size={13} /></span>
        <span className="brand-name">read<em>vibe</em></span>
      </NavLink>
      <div className="mobile-header-actions">
        <button className="icon-ghost" onClick={() => setSearchOpen(true)} aria-label="Search"><Search size={18} /></button>
        <QuickActions inline />
        <Notifications />
        <NavLink to="/settings" className="mobile-avatar" aria-label="Profile and settings">
          {user?.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(user?.name)}
        </NavLink>
      </div>
    </header>
  );
}
