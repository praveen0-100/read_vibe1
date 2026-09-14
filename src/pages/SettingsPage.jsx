// ─── Settings Page ────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  Sun, Moon, BookOpen, Headphones, Zap, Cloud, User, Music,
  ChevronRight, Check, Monitor
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const SETTING_SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'reading', label: 'Reading', icon: BookOpen },
  { id: 'audio', label: 'Audio & Voice', icon: Headphones },
  { id: 'accessibility', label: 'Accessibility', icon: Zap },
  { id: 'vibe', label: 'Music & Vibe', icon: Music },
  { id: 'storage', label: 'Storage & Offline', icon: Cloud },
  { id: 'account', label: 'Account', icon: User },
];

function Toggle({ value, onChange, label }) {
  return (
    <button
      className="toggle-switch"
      onClick={() => onChange(!value)}
      aria-checked={value}
      role="switch"
      aria-label={label}
    >
      <span className={`toggle-track ${value ? 'on' : ''}`}>
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}

function SettingRow({ label, description, control }) {
  return (
    <div className="setting-row">
      <div className="setting-row-label">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      <div className="setting-row-control">{control}</div>
    </div>
  );
}

function AppearanceSection({ state, dispatch }) {
  const { theme } = state;
  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Appearance</h2>
        <p>Make ReadVibe feel like your space.</p>
      </div>
      <div className="theme-options">
        {[
          { id: 'light', label: 'Light', icon: Sun },
          { id: 'dark', label: 'Dark', icon: Moon },
          { id: 'system', label: 'System', icon: Monitor },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`theme-option ${theme === id ? 'chosen' : ''}`}
            onClick={() => dispatch({ type: 'SET_THEME', payload: id })}
          >
            <Icon size={18} />
            <span>{label}</span>
            {theme === id && <Check size={14} className="check" />}
          </button>
        ))}
      </div>

      <div className="setting-group">
        <div className="setting-group-label">Color accent</div>
        <div className="accent-swatches">
          {['#ee8b72', '#73c99e', '#9b8de8', '#6ca8d4', '#d4a26a', '#e87298'].map(color => (
            <button
              key={color}
              className="accent-swatch"
              style={{ background: color }}
              onClick={() => {}}
              title={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadingSection({ state, dispatch }) {
  const { readingSettings } = state;
  const [settings, setSettings] = useState(readingSettings);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    dispatch({ type: 'SET_READING_SETTINGS', payload: next });
  };

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Reading preferences</h2>
        <p>Customize your ideal reading environment.</p>
      </div>
      <div className="setting-rows-list">
        <SettingRow
          label="Reading font"
          description="Font used for document text"
          control={
            <select value={settings.font} onChange={e => update('font', e.target.value)}>
              <option value="Playfair Display">Playfair Display (Serif)</option>
              <option value="DM Sans">DM Sans (Sans-serif)</option>
              <option value="Georgia">Georgia (Classic)</option>
              <option value="OpenDyslexic">OpenDyslexic</option>
            </select>
          }
        />
        <SettingRow
          label="Text size"
          description={`${settings.fontSize}px`}
          control={
            <input
              type="range"
              min={13}
              max={24}
              value={settings.fontSize}
              onChange={e => update('fontSize', +e.target.value)}
              aria-label="Font size"
            />
          }
        />
        <SettingRow
          label="Line spacing"
          control={
            <select value={settings.lineHeight} onChange={e => update('lineHeight', +e.target.value)}>
              <option value={1.4}>Compact (1.4)</option>
              <option value={1.6}>Standard (1.6)</option>
              <option value={1.8}>Relaxed (1.8)</option>
              <option value={2.0}>Spacious (2.0)</option>
            </select>
          }
        />
        <SettingRow
          label="Reading margins"
          control={
            <select value={settings.margins} onChange={e => update('margins', e.target.value)}>
              <option value="narrow">Narrow</option>
              <option value="comfortable">Comfortable</option>
              <option value="wide">Wide</option>
            </select>
          }
        />
        <SettingRow
          label="Page theme"
          control={
            <select value={settings.theme} onChange={e => update('theme', e.target.value)}>
              <option value="sepia">Sepia (warm)</option>
              <option value="white">White (crisp)</option>
              <option value="dark">Dark (night)</option>
              <option value="sage">Sage (calm)</option>
            </select>
          }
        />
      </div>
    </div>
  );
}

function AudioSection({ state, dispatch, notify }) {
  const [defaultSpeed, setDefaultSpeed] = useState(1.0);
  const [defaultTone, setDefaultTone] = useState('Regular');
  const [sleepTimer, setSleepTimer] = useState('off');
  const [bgPlayback, setBgPlayback] = useState(true);

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Audio & Voice</h2>
        <p>Configure your audiobook listening experience.</p>
      </div>
      <div className="setting-rows-list">
        <SettingRow
          label="Default playback speed"
          control={
            <select value={defaultSpeed} onChange={e => setDefaultSpeed(+e.target.value)}>
              {[0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map(s => <option key={s} value={s}>{s}×</option>)}
            </select>
          }
        />
        <SettingRow
          label="Default narration tone"
          control={
            <select value={defaultTone} onChange={e => setDefaultTone(e.target.value)}>
              <option>Regular</option>
              <option>Humor</option>
              <option>Tough</option>
            </select>
          }
        />
        <SettingRow
          label="Sleep timer"
          control={
            <select value={sleepTimer} onChange={e => setSleepTimer(e.target.value)}>
              <option value="off">Off</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
            </select>
          }
        />
        <SettingRow
          label="Background playback"
          description="Continue playing when you switch screens"
          control={<Toggle value={bgPlayback} onChange={setBgPlayback} label="Background playback" />}
        />
        <SettingRow
          label="Auto-play next chapter"
          control={<Toggle value={true} onChange={() => notify('Setting saved')} label="Auto-play next chapter" />}
        />
      </div>
    </div>
  );
}

function AccessibilitySection({ notify }) {
  const [settings, setSettings] = useState({
    highContrast: true,
    reducedMotion: false,
    dyslexicFont: false,
    screenReader: false,
    focusLine: false,
    largeTargets: false,
  });

  const toggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
    notify('Accessibility setting saved');
  };

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Accessibility</h2>
        <p>Reading support that works for you.</p>
      </div>
      <div className="setting-rows-list">
        <SettingRow label="High contrast" description="Increases text contrast for readability" control={<Toggle value={settings.highContrast} onChange={() => toggle('highContrast')} label="High contrast" />} />
        <SettingRow label="Reduced motion" description="Minimizes animations" control={<Toggle value={settings.reducedMotion} onChange={() => toggle('reducedMotion')} label="Reduced motion" />} />
        <SettingRow label="Dyslexia-friendly font" description="Switch to OpenDyslexic for all reading" control={<Toggle value={settings.dyslexicFont} onChange={() => toggle('dyslexicFont')} label="Dyslexia-friendly font" />} />
        <SettingRow label="Screen reader mode" description="Optimized layout for screen readers" control={<Toggle value={settings.screenReader} onChange={() => toggle('screenReader')} label="Screen reader mode" />} />
        <SettingRow label="Focus line" description="Highlight current reading line" control={<Toggle value={settings.focusLine} onChange={() => toggle('focusLine')} label="Focus line" />} />
        <SettingRow label="Large touch targets" description="Increases tap area for all buttons" control={<Toggle value={settings.largeTargets} onChange={() => toggle('largeTargets')} label="Large touch targets" />} />
      </div>
    </div>
  );
}

function StorageSection({ notify }) {
  const [offlineDocs, setOfflineDocs] = useState(true);
  const [offlineAudio, setOfflineAudio] = useState(false);

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Storage & Offline</h2>
        <p>Manage what's available when you're not connected.</p>
      </div>
      <div className="storage-stats">
        <div className="storage-bar-wrap">
          <div className="storage-bar">
            <div className="storage-docs" style={{ width: '35%' }} />
            <div className="storage-audio" style={{ width: '25%' }} />
          </div>
          <div className="storage-legend">
            <span><i className="docs" /> Documents — 142 MB</span>
            <span><i className="audio" /> Audio — 890 MB</span>
            <span><i className="free" /> Free — 14.1 GB</span>
          </div>
        </div>
      </div>
      <div className="setting-rows-list">
        <SettingRow label="Download documents for offline" control={<Toggle value={offlineDocs} onChange={setOfflineDocs} label="Offline documents" />} />
        <SettingRow label="Download audio for offline" control={<Toggle value={offlineAudio} onChange={setOfflineAudio} label="Offline audio" />} />
        <SettingRow
          label="Clear cache"
          description="Frees temporary files"
          control={<button className="secondary-button small" onClick={() => notify('Cache cleared (124 MB freed)')}>Clear cache</button>}
        />
      </div>
    </div>
  );
}

function AccountSection({ notify }) {
  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2>Account</h2>
      </div>
      <div className="account-profile">
        <div className="avatar-large">PS</div>
        <div>
          <strong>Praveen S.</strong>
          <small>praveen@example.com</small>
          <button className="text-button" onClick={() => notify('Profile edit opened')}>Edit profile →</button>
        </div>
      </div>
      <div className="setting-rows-list">
        {['Connected services', 'Reading data & privacy', 'Export all data', 'Sign out'].map(item => (
          <button key={item} className="setting-link-row" onClick={() => notify(`${item} — opened`)}>
            <span>{item}</span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { state, dispatch, notify } = useApp();
  const [activeSection, setActiveSection] = useState('appearance');

  const panels = {
    appearance: <AppearanceSection state={state} dispatch={dispatch} />,
    reading: <ReadingSection state={state} dispatch={dispatch} />,
    audio: <AudioSection state={state} dispatch={dispatch} notify={notify} />,
    accessibility: <AccessibilitySection notify={notify} />,
    storage: <StorageSection notify={notify} />,
    account: <AccountSection notify={notify} />,
    vibe: (
      <div className="settings-panel">
        <div className="panel-header"><h2>Music & Vibe</h2><p>Configure your music connection and saved vibe presets.</p></div>
        <div className="setting-rows-list">
          <SettingRow label="Music service" control={<select><option>None connected</option><option>Spotify</option><option>Local music</option></select>} />
          <SettingRow label="Default vibe preset" control={<select defaultValue="chill"><option value="chill">Chill</option><option>Study</option><option>Rainy</option><option>Cinematic</option></select>} />
        </div>
      </div>
    ),
  };

  return (
    <div className="page-shell settings-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-nav" aria-label="Settings navigation">
          {SETTING_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={activeSection === id ? 'active' : ''}
              onClick={() => setActiveSection(id)}
              aria-current={activeSection === id ? 'page' : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </aside>

        <div className="settings-content">
          {panels[activeSection]}
        </div>
      </div>
    </div>
  );
}
