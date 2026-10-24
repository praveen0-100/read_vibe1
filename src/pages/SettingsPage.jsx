// ─── Settings ─────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Accessibility, AudioLines, BookOpen, Check, Database, Download, HardDrive, Keyboard, LogOut, Monitor, Moon, Palette,
  Play, Server, Sun, Trash2, User, Volume2,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { formatBytes, initials, timeAgo } from '../lib/format';
import { offline } from '../lib/offline';
import { READING_FONTS } from '../lib/prefs';
import { loadVoices, pickVoice, speak, speechSupported } from '../lib/speech';
import { Field, Segmented, Slider, Switch } from '../components/ui';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'reading', label: 'Reading', icon: BookOpen },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'vibe', label: 'Music & Vibe', icon: AudioLines },
  { id: 'storage', label: 'Storage & Offline', icon: HardDrive },
  { id: 'account', label: 'Account', icon: User },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
];

function GoogleMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="setting-section">
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      <div className="setting-rows">{children}</div>
    </section>
  );
}

function Appearance() {
  const { prefs, setPrefs } = useApp();
  return (
    <>
      <Section title="Theme" description="Choose how ReadVibe looks. System follows your device.">
        <Segmented value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} label="Theme"
          options={[{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }]} />
      </Section>
      <Section title="Accent colour" description="Used for buttons, progress and AI actions.">
        <div className="accent-picker">
          {['coral', 'violet', 'teal', 'gold'].map((a) => (
            <button key={a} className={`accent-swatch accent-${a} ${prefs.accent === a ? 'chosen' : ''}`} onClick={() => setPrefs({ accent: a })} aria-label={a} aria-pressed={prefs.accent === a}>
              {prefs.accent === a && <Check size={14} />}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Interface size" description="Scales all interface text and controls.">
        <Slider label="UI scale" value={prefs.accessibility.uiScale} min={85} max={130} step={5} onChange={(v) => setPrefs({ accessibility: { uiScale: v } })} format={(v) => `${v}%`} />
      </Section>
    </>
  );
}

function Reading() {
  const { prefs, setPrefs } = useApp();
  const r = prefs.reading;
  const set = (p) => setPrefs({ reading: p });
  return (
    <>
      <Section title="Typeface" description="Serif, sans-serif and dyslexia-friendly options.">
        <div className="font-options">
          {Object.entries(READING_FONTS).map(([id, f]) => (
            <button key={id} className={`font-btn ${r.font === id ? 'chosen' : ''}`} style={{ fontFamily: f.css }} onClick={() => set({ font: id })} aria-pressed={r.font === id}>{f.label}</button>
          ))}
        </div>
      </Section>
      <Section title="Text layout">
        <Slider label="Font size" value={r.fontSize} min={13} max={30} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
        <Slider label="Line spacing" value={r.lineHeight} min={1.3} max={2.4} step={0.05} onChange={(v) => set({ lineHeight: v })} format={(v) => v.toFixed(2)} />
        <Slider label="Paragraph spacing" value={r.paragraphSpacing} min={0.4} max={2} step={0.1} onChange={(v) => set({ paragraphSpacing: v })} format={(v) => `${v.toFixed(1)}em`} />
        <Segmented size="sm" value={r.width} onChange={(v) => set({ width: v })} label="Reading width" options={[{ value: 'narrow', label: 'Narrow' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'wide', label: 'Wide' }]} />
        <Segmented size="sm" value={r.align} onChange={(v) => set({ align: v })} label="Alignment" options={[{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justified' }]} />
      </Section>
      <Section title="Page colour">
        <Segmented size="sm" value={r.paper} onChange={(v) => set({ paper: v })} label="Page colour" options={[{ value: 'paper', label: 'Paper' }, { value: 'sepia', label: 'Sepia' }, { value: 'night', label: 'Night' }, { value: 'contrast', label: 'High contrast' }]} />
        <div className={`reading-preview swatch-${r.paper}`} style={{ fontFamily: READING_FONTS[r.font].css, fontSize: r.fontSize, lineHeight: r.lineHeight, textAlign: r.align }}>
          The challenge of reading well is to give one thing your whole attention. Good typography makes that easier.
        </div>
      </Section>
      <Section title="Reading aids">
        <Switch label="Focus line" description="Dim surrounding paragraphs" checked={r.focusLine} onChange={(v) => set({ focusLine: v })} />
        <Switch label="Reading ruler" description="A guide band that follows the pointer" checked={r.ruler} onChange={(v) => set({ ruler: v })} />
      </Section>
    </>
  );
}

function AccessibilitySettings() {
  const { prefs, setPrefs } = useApp();
  const a = prefs.accessibility;
  return (
    <Section title="Accessibility" description="ReadVibe supports screen readers, keyboard navigation and these display options.">
      <Switch label="Dyslexia-friendly font" description="Use OpenDyslexic in the reader" checked={prefs.reading.font === 'dyslexic'} onChange={(v) => setPrefs({ reading: { font: v ? 'dyslexic' : 'serif' } })} />
      <Switch label="High contrast" description="Stronger text and border contrast everywhere" checked={a.highContrast} onChange={(v) => setPrefs({ accessibility: { highContrast: v } })} />
      <Switch label="Reduce motion" description="Static backgrounds in Zen and Vibe, no animated transitions" checked={a.reducedMotion} onChange={(v) => setPrefs({ accessibility: { reducedMotion: v } })} />
      <Switch label="Large touch targets" description="Bigger buttons for touch and motor accessibility" checked={a.largeTargets} onChange={(v) => setPrefs({ accessibility: { largeTargets: v } })} />
      <Slider label="Interface size" value={a.uiScale} min={85} max={130} step={5} onChange={(v) => setPrefs({ accessibility: { uiScale: v } })} format={(v) => `${v}%`} />
    </Section>
  );
}

function AudioSettings() {
  const { prefs, setPrefs } = useApp();
  const [voices, setVoices] = useState([]);
  const [neural, setNeural] = useState([]); // natural voices offered by the server
  const [testing, setTesting] = useState(false);
  const [langs, setLangs] = useState([]); // language catalogue: Tamil, Telugu, Malayalam, Kannada first
  useEffect(() => { loadVoices().then(setVoices); }, []);
  useEffect(() => { api.tts.languages().then(setLangs).catch(() => setLangs([])); }, []);
  useEffect(() => { api.tts.voices().then(setNeural).catch(() => setNeural([])); }, []);
  const au = prefs.audio;
  const natural = neural.length > 0 && au.engine !== 'device';
  const previewLang = async (l, voice) => {
    setTesting(true);
    try {
      const r = await api.tts.synthesize(l.sample, voice);
      const audio = new Audio(`data:${r.mime};base64,${r.audio}`);
      audio.playbackRate = au.rate;
      audio.onended = () => setTesting(false);
      await audio.play();
    } catch { setTesting(false); }
  };
  const test = async () => {
    const line = 'This is how ReadVibe will read to you.';
    if (!natural) { speak(line, { rate: au.rate, voice: pickVoice(voices, au.voice, au.tone) }); return; }
    setTesting(true);
    try {
      const r = await api.tts.synthesize(line, au.naturalVoice);
      const audio = new Audio(`data:${r.mime};base64,${r.audio}`);
      audio.playbackRate = au.rate;
      audio.onended = () => setTesting(false);
      await audio.play();
    } catch { setTesting(false); }
  };
  return (
    <Section title="Narration defaults" description={natural ? 'Natural neural voices, like an audiobook narrator.' : speechSupported ? 'Uses your device’s speech engine — works offline.' : 'This browser has no speech engine; narration is unavailable.'}>
      {neural.length > 0 && (
        <Switch label="Natural voices" description="Human-sounding narration with real accents. Turn off to use your device’s own voices offline." checked={au.engine !== 'device'} onChange={(v) => setPrefs({ audio: { engine: v ? 'natural' : 'device' } })} />
      )}
      {natural && langs.length > 0 && (
        <div className="voice-langs" role="group" aria-label="Voices by language">
          <div className="voice-langs-head"><strong>Voices by language</strong><small>Documents are read in their own language automatically — Southern languages first.</small></div>
          {langs.filter((l) => l.has_voice).map((l) => {
            const options = neural.filter((v) => v.lang === l.code);
            const chosen = l.code === 'en' ? au.naturalVoice : (au.langVoices?.[l.code] || l.voices[0]?.id);
            return (
              <div key={l.code} className="voice-lang-row">
                <span className="voice-lang-name"><b lang={l.code}>{l.native}</b><small>{l.name}</small></span>
                <select value={chosen} aria-label={`${l.name} voice`}
                  onChange={(e) => setPrefs({ audio: l.code === 'en' ? { naturalVoice: e.target.value } : { langVoices: { ...au.langVoices, [l.code]: e.target.value } } })}>
                  {(options.length ? options : l.voices.map((v) => ({ ...v, id: v.id }))).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.gender}</option>)}
                </select>
                <button className="secondary-button sm" onClick={() => previewLang(l, chosen)} disabled={testing} aria-label={`Preview ${l.name} voice`}><Play size={12} /></button>
              </div>
            );
          })}
        </div>
      )}
      <Segmented size="sm" value={au.tone} onChange={(v) => setPrefs({ audio: { tone: v } })} label="Default tone" options={['Regular', 'Humor', 'Tough']} />
      <Slider label="Default speed" value={au.rate} min={0.5} max={3} step={0.25} onChange={(v) => setPrefs({ audio: { rate: v } })} format={(v) => `${v}×`} />
      {voices.length > 0 && !natural && (
        <label className="setting-line">Voice
          <select value={au.voice} onChange={(e) => setPrefs({ audio: { voice: e.target.value } })}>
            <option value="">Automatic (best for tone)</option>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
        </label>
      )}
      <label className="setting-line">Default sleep timer
        <select value={au.sleepTimer} onChange={(e) => setPrefs({ audio: { sleepTimer: +e.target.value } })}>
          {[0, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m ? `${m} min` : 'Off'}</option>)}
        </select>
      </label>
      <Switch label="Auto-play next chapter" checked={au.autoAdvance} onChange={(v) => setPrefs({ audio: { autoAdvance: v } })} />
      <button className="secondary-button" onClick={test} disabled={(!speechSupported && !natural) || testing}><Play size={13} /> {testing ? 'Playing…' : 'Test voice'}</button>
    </Section>
  );
}

function VibeSettings() {
  const { prefs, setPrefs } = useApp();
  return (
    <>
      <Section title="Zen defaults" description="Music volume and focus-session lengths.">
        <label className="setting-line">Focus length
          <select value={prefs.zen.focusMinutes} onChange={(e) => setPrefs({ zen: { focusMinutes: +e.target.value } })}>{[15, 20, 25, 30, 45, 50, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        </label>
        <label className="setting-line">Break length
          <select value={prefs.zen.breakMinutes} onChange={(e) => setPrefs({ zen: { breakMinutes: +e.target.value } })}>{[3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        </label>
        <Slider label="Music volume" value={prefs.zen.volume} onChange={(v) => setPrefs({ zen: { volume: v } })} format={(v) => `${v}%`} />
      </Section>
      <Section title="Vibe Reader" description="Pick local music inside Vibe mode — files stay on your device. Streaming-service playlists can be connected by a deployment that registers an OAuth app.">
        <Slider label="Text contrast" value={prefs.vibe.contrast} min={50} max={100} onChange={(v) => setPrefs({ vibe: { contrast: v } })} format={(v) => `${v}%`} />
      </Section>
    </>
  );
}

function Storage() {
  const { notify, confirm, refreshData } = useApp();
  const [items, setItems] = useState(null);
  const [usage, setUsage] = useState(null);
  const load = () => {
    offline.list().then(setItems).catch(() => setItems([]));
    offline.usage().then(setUsage).catch(() => {});
  };
  useEffect(load, []);
  const remove = async (it) => {
    await offline.remove(it.id);
    api.documents.update(it.id, { offline: false }).catch(() => {});
    load();
    refreshData();
  };
  const clearAll = async () => {
    if (!(await confirm({ title: 'Remove all offline documents?', message: 'They stay in your library and can be downloaded again.', confirmLabel: 'Remove all', danger: true }))) return;
    await Promise.all((items || []).map((it) => api.documents.update(it.id, { offline: false }).catch(() => {})));
    await offline.clear();
    notify('Offline storage cleared');
    load();
    refreshData();
  };
  return (
    <Section title="Offline documents" description="Saved documents open without internet — including highlights and bookmarks.">
      <div className="storage-meter">
        <Database size={16} />
        <span>{usage ? `${usage.count} document${usage.count === 1 ? '' : 's'} · ${formatBytes(usage.bytes)}` : '…'}{usage?.quota ? ` of ${formatBytes(usage.quota)} available` : ''}</span>
      </div>
      {items?.length === 0 && <p className="muted small">Nothing saved yet. Use “Make available offline” in the library.</p>}
      <ul className="offline-list">
        {(items || []).map((it) => (
          <li key={it.id}>
            <span><strong>{it.document.title}</strong><small>{it.chapters.length} chapters · saved {timeAgo(it.savedAt)}</small></span>
            <button className="icon-ghost sm" onClick={() => remove(it)} aria-label={`Remove ${it.document.title}`}><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      {items?.length > 0 && <button className="secondary-button danger-text" onClick={clearAll}><Trash2 size={13} /> Remove all offline copies</button>}
    </Section>
  );
}

function Account() {
  const { user, setUser, notify, confirm, auth } = useApp();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const health = useQuery(() => api.health(), []);
  const saveProfile = async (e) => {
    e.preventDefault();
    try { setUser(await api.auth.update(profile)); notify('Profile updated'); } catch (err) { notify(err.message, 'error'); }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api.auth.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      if (user?.has_password === false) setUser({ ...user, has_password: true });
      notify(user?.has_password === false ? 'Password set — you can now also sign in with email' : 'Password changed');
    } catch (err) { notify(err.message, 'error'); }
  };
  const deleteAccount = async () => {
    if (!(await confirm({ title: 'Delete your account?', message: 'All documents, notes, audiobooks and research projects will be permanently deleted. This cannot be undone.', confirmLabel: 'Delete account', danger: true }))) return;
    try { await api.auth.deleteAccount(); await offline.clear().catch(() => {}); auth.logout(); navigate('/login'); } catch (err) { notify(err.message, 'error'); }
  };
  return (
    <>
      <Section title="Profile">
        <div className="profile-card">
          {user?.avatar_url ? <img className="avatar lg" src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className="avatar lg">{initials(user?.name)}</span>}
          <div>
            <strong>{user?.name}</strong>
            <small>Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</small>
            {user?.google_linked && <span className="google-badge"><GoogleMark /> Connected to Google</span>}
          </div>
        </div>
        <form className="stack" onSubmit={saveProfile}>
          <Field label="Name"><input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
          <button className="primary-button" disabled={!profile.name.trim()}>Save profile</button>
        </form>
      </Section>
      <Section title="Password" description={user?.has_password === false ? 'You sign in with Google. Add a password to also sign in with your email.' : undefined}>
        <form className="stack" onSubmit={changePw}>
          {user?.has_password !== false && (
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          )}
          <Field label="New password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <button className="secondary-button" disabled={(user?.has_password !== false && !pw.current) || pw.next.length < 8}>
            {user?.has_password === false ? 'Set password' : 'Change password'}
          </button>
        </form>
      </Section>
      <Section title="Your data" description="Download everything ReadVibe stores about you, or delete your account.">
        <button className="secondary-button" onClick={() => api.auth.exportData().catch((e) => notify(e.message, 'error'))}><Download size={14} /> Export my data (.zip)</button>
        <button className="secondary-button" onClick={() => { auth.logout(); navigate('/login'); }}><LogOut size={14} /> Sign out</button>
        <button className="secondary-button danger-text" onClick={deleteAccount}><Trash2 size={14} /> Delete account</button>
      </Section>
      <Section title="Service status">
        <div className="status-grid">
          <span><Server size={14} /> API</span><strong className={health.data?.status === 'ok' ? 'ok' : 'bad'}>{health.data ? `${health.data.status} · v${health.data.version}` : health.error ? 'unreachable' : '…'}</strong>
          <span><AudioLines size={14} /> AI engine</span><strong>{health.data?.ai_provider === 'local' ? 'ReadVibe local engine' : health.data?.ai_provider || '…'}</strong>
        </div>
      </Section>
    </>
  );
}

const SHORTCUTS = [
  ['Global', [['Ctrl/⌘ K or /', 'Search everything'], ['U', 'Upload a document'], ['A', 'Open the AI companion'], ['[', 'Collapse sidebar'], ['G then H/L/R/A/S/N', 'Go to Home, Library, Read, Audio, Research, Notebook']]],
  ['Reader', [['Ctrl/⌘ F', 'Search in document'], ['N / P', 'Next / previous section'], ['B', 'Bookmark this position'], ['M', 'Switch Reader → Zen → Vibe'], ['L', 'Read aloud'], ['T', 'Display settings'], ['A', 'AI companion'], ['Esc', 'Close popovers']]],
  ['Audio player', [['Space', 'Play / pause'], ['← / →', 'Back 10s / forward 30s']]],
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'appearance';
  const views = { appearance: <Appearance />, reading: <Reading />, accessibility: <AccessibilitySettings />, audio: <AudioSettings />, vibe: <VibeSettings />, storage: <Storage />, account: <Account /> };
  return (
    <div className="page-shell settings-page">
      <header className="topbar"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1></div></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setParams({ tab: id })} aria-current={tab === id ? 'page' : undefined}><Icon size={16} /> {label}</button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'shortcuts' ? (
            <Section title="Keyboard shortcuts" description="Shortcuts are ignored while typing in a text field.">
              {SHORTCUTS.map(([group, list]) => (
                <div key={group} className="shortcut-group">
                  <div className="eyebrow">{group}</div>
                  {list.map(([k, d]) => <div key={k} className="shortcut"><kbd>{k}</kbd><span>{d}</span></div>)}
                </div>
              ))}
            </Section>
          ) : views[tab] || views.appearance}
          <p className="fineprint">Preferences sync to your account and apply on every device.</p>
        </div>
      </div>
    </div>
  );
}
