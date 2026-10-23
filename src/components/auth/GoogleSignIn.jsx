// "Sign in with Google" using Google Identity Services.
// Google renders its own button and returns a signed ID token; the API verifies it.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { resolveTheme } from '../../lib/prefs';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise = null;

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const fail = () => {
        gsiPromise = null;
        s.remove();
        reject(new Error('Couldn’t load Google sign-in. Check your connection or content blockers.'));
      };
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      const timer = setTimeout(fail, 15000); // never leave the button spinning forever
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); fail(); };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function GoogleSignIn({ onCredential, onError, disabled, theme = 'dark' }) {
  const ref = useRef(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;
  const [state, setState] = useState('loading'); // loading | ready | off | error
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    setState('loading');
    let cancelled = false;
    (async () => {
      try {
        // Fetch the config and Google's script side by side — neither waits on the other.
        const script = loadGsi();
        script.catch(() => {}); // surfaced below, only if Google sign-in turns out to be enabled
        const cfg = await api.auth.config();
        if (!cfg.google_enabled) { if (!cancelled) setState('off'); return; }
        await script;
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: cfg.google_client_id,
          callback: (resp) => resp?.credential && cbRef.current(resp.credential),
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
        });
        const width = Math.min(380, Math.max(220, ref.current.offsetWidth || 380));
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: resolveTheme(theme) === 'light' ? 'outline' : 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        });
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setMessage(err.message);
        onError?.(err);
      }
    })();
    return () => { cancelled = true; };
  }, [theme, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'off') {
    // Always show the option; explain what's missing instead of hiding it.
    return (
      <div className="google-signin">
        <button type="button" className="google-fallback" onClick={() => setShowSetup((s) => !s)} aria-expanded={showSetup}>
          <GoogleG /> Continue with Google
        </button>
        {showSetup && (
          <div className="google-setup" role="note">
            {import.meta.env.DEV ? (
              <>
                <strong>Google sign-in needs a Client ID</strong>
                <ol>
                  <li>Google Cloud Console → APIs &amp; Services → Credentials → <em>Create OAuth client ID</em> (Web application).</li>
                  <li>Add <code>{window.location.origin}</code> under <em>Authorized JavaScript origins</em>.</li>
                  <li>Put <code>READVIBE_GOOGLE_CLIENT_ID=…</code> in <code>backend/.env</code> and restart the API.</li>
                </ol>
              </>
            ) : (
              <span>Google sign-in isn’t enabled on this server yet. Please sign in with email, or try the demo library.</span>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`google-signin ${disabled ? 'disabled' : ''}`} aria-busy={state === 'loading'}>
      {state === 'loading' && <div className="google-placeholder"><Loader2 size={15} className="spin" /> Loading Google sign-in…</div>}
      {state === 'error' && (
        <p className="google-hint error">
          {message} <button type="button" className="text-button" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
        </p>
      )}
      <div ref={ref} className="google-button-host" hidden={state !== 'ready'} />
    </div>
  );
}
