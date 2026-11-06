// Security: two-factor authentication (authenticator app + recovery codes) and the account's sign-in history.
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { timeAgo } from '../../lib/format';

const LABEL = {
  login_success: 'Signed in', login_failed: 'Failed sign-in attempt', login_locked: 'Sign-in blocked (too many attempts)', mfa_failed: 'Wrong two-step code',
  mfa_enabled: 'Two-step verification turned on', mfa_disabled: 'Two-step verification turned off', backup_code_used: 'Signed in with a recovery code',
  password_changed: 'Password changed', google_login: 'Signed in with Google',
};

export default function SecuritySettings() {
  const { notify } = useApp();
  const [version, setVersion] = useState(0);
  const info = useQuery(() => api.auth.security(), [version]);
  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState(null); // recovery codes, shown once
  const [busy, setBusy] = useState(false);
  const d = info.data;

  const run = async (fn, after) => {
    setBusy(true);
    try { const r = await fn(); after?.(r); } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify('Copied'));

  return (
    <div className="settings-stack">
      <section className="settings-section">
        <h3><ShieldCheck size={16} /> Two-step verification</h3>
        <p className="muted">Protect your account with a code from an authenticator app (Google Authenticator, Authy, 1Password…). Signing in then needs your password <em>and</em> a 6-digit code.</p>

        {!d ? <Loader2 size={16} className="spin" /> : codes ? (
          <div className="sec-codes" role="alert">
            <strong><AlertTriangle size={14} /> Save your recovery codes</strong>
            <p>Each code works once if you lose your phone. They will not be shown again.</p>
            <ul>{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
            <button className="secondary-button" onClick={() => copy(codes.join('\n'))}><Copy size={14} /> Copy all</button>{' '}
            <button className="primary-button" onClick={() => { setCodes(null); setVersion((v) => v + 1); }}>I’ve saved them</button>
          </div>
        ) : d.two_factor ? (
          <div className="stack">
            <p className="sec-on"><CheckCircle2 size={14} /> On · {d.backup_codes_left} recovery code{d.backup_codes_left === 1 ? '' : 's'} left</p>
            <div className="sec-row">
              {d.has_password && <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              <input className="input" inputMode="numeric" placeholder="Code from your app" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="secondary-button danger" disabled={busy || code.length < 6}
                onClick={() => run(() => api.auth.mfaDisable(code, password), () => { setCode(''); setPassword(''); notify('Two-step verification is off'); setVersion((v) => v + 1); })}>Turn off</button>
            </div>
          </div>
        ) : setup ? (
          <div className="stack">
            <ol className="sec-steps">
              <li>Add ReadVibe to your authenticator app using this key (choose “enter a setup key”, time-based).</li>
              <li className="sec-secret"><code>{setup.secret.match(/.{1,4}/g).join(' ')}</code> <button className="text-button" onClick={() => copy(setup.secret)}><Copy size={12} /> Copy</button>
                {' '}<a href={setup.otpauth_uri} className="text-button">Open in app</a></li>
              <li>Enter the 6-digit code it shows to confirm.</li>
            </ol>
            <div className="sec-row">
              <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="primary-button" disabled={busy || code.replace(/\s/g, '').length < 6}
                onClick={() => run(() => api.auth.mfaEnable(code), (r) => { setCodes(r.backup_codes); setSetup(null); setCode(''); })}>Turn on</button>
              <button className="text-button" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="primary-button" disabled={busy} onClick={() => run(() => api.auth.mfaSetup(), setSetup)}><KeyRound size={14} /> Set up two-step verification</button>
        )}
      </section>

      <section className="settings-section">
        <h3>Recent security activity</h3>
        {!d ? null : d.events.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="sec-events">
            {d.events.map((e, i) => (
              <li key={i} className={/failed|locked/.test(e.event) ? 'warn' : ''}>
                <strong>{LABEL[e.event] || e.event}</strong>
                <small>{timeAgo(e.at)}{e.ip ? ` · ${e.ip}` : ''}</small>
              </li>
            ))}
          </ul>
        )}
        <p className="fineprint">After 5 wrong passwords an account is locked for 15 minutes. If you see activity you don’t recognise, change your password.</p>
      </section>
    </div>
  );
}
