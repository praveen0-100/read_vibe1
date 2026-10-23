// ─── Sign in / sign up ────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, AudioLines, BookOpen, Brain, Eye, EyeOff, Loader2, Moon, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isWaking, onWaking } from '../api/client';
import { Field } from '../components/ui';
import GoogleSignIn from '../components/auth/GoogleSignIn';

const FEATURES = [
  { icon: BookOpen, title: 'Reader, Zen & Vibe modes', text: 'Switch atmospheres without losing your place.' },
  { icon: Sparkles, title: 'An AI companion grounded in your text', text: 'Summaries, explanations, mind maps, quizzes.' },
  { icon: AudioLines, title: 'Multi-tone audiobooks', text: 'Humor, tough or regular narration — or record together.' },
  { icon: Brain, title: 'Research Studio', text: 'Discover papers, draft sections, export with citations.' },
];

export default function LoginPage() {
  const { auth, notify, prefs } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const dest = location.state?.from?.pathname || '/';
  const [waking, setWaking] = useState(isWaking);
  useEffect(() => onWaking(setWaking), []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy('form');
    try {
      const user = mode === 'login'
        ? await auth.login(form.email.trim(), form.password)
        : await auth.register(form.name.trim(), form.email.trim(), form.password);
      notify(mode === 'login' ? `Welcome back, ${user.name.split(' ')[0]}` : `Welcome to ReadVibe, ${user.name.split(' ')[0]}!`);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.status === 422 ? 'Please check your details — passwords need at least 8 characters.' : err.message);
    } finally {
      setBusy(null);
    }
  };

  const google = async (credential) => {
    setError('');
    setBusy('google');
    try {
      const user = await auth.google(credential);
      notify(`Welcome, ${user.name.split(' ')[0]}`);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setError('');
    setBusy('demo');
    try {
      await auth.demo();
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-page">
      <section className="auth-hero" aria-hidden="true">
        <div className="brand"><span className="brand-mark"><Sparkles size={14} /></span><span className="brand-name">read<em>vibe</em></span></div>
        <h1>Read beyond<br /><em>the page.</em></h1>
        <p>An AI-powered reading ecosystem that turns documents into immersive reading, personal audiobooks and research-ready knowledge.</p>
        <ul className="auth-features">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title}><span><Icon size={16} /></span><div><strong>{title}</strong><small>{text}</small></div></li>
          ))}
        </ul>
        <div className="auth-glow" />
        <Moon className="auth-moon" size={120} strokeWidth={0.6} />
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'CREATE YOUR SPACE'}</div>
          <h2>{mode === 'login' ? 'Sign in to ReadVibe' : 'Start reading with ReadVibe'}</h2>

          {mode === 'register' && (
            <Field label="Name"><input className="input" autoComplete="name" required value={form.name} onChange={set('name')} placeholder="Your name" /></Field>
          )}
          <Field label="Email"><input className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
            <div className="input-with-btn">
              <input className="input" type={showPw ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required minLength={mode === 'register' ? 8 : 1} value={form.password} onChange={set('password')} placeholder="••••••••" />
              <button type="button" className="icon-ghost sm" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          {waking && (
            <div className="form-hint" role="status">
              <Loader2 size={13} className="spin" /> Waking the ReadVibe server — free hosting sleeps when idle. This can take up to half a minute, and your request will go through automatically.
            </div>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="primary-button full-width" disabled={!!busy || !form.email || !form.password || (mode === 'register' && !form.name)}>
            {busy === 'form' ? <Loader2 size={15} className="spin" /> : null}
            {mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={15} />
          </button>

          <div className="auth-divider"><span>or</span></div>
          <GoogleSignIn theme={prefs.theme} disabled={!!busy} onCredential={google} onError={() => {}} />
          {busy === 'google' && <p className="google-hint"><Loader2 size={13} className="spin" /> Signing you in with Google…</p>}
          <button type="button" className="secondary-button full-width" onClick={demo} disabled={!!busy}>
            {busy === 'demo' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Explore the demo library
          </button>

          <p className="auth-switch">
            {mode === 'login' ? 'New to ReadVibe?' : 'Already have an account?'}{' '}
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
