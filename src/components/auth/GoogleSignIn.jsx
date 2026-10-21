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

export default function GoogleSignIn({ onCredential, onError, disabled, theme = 'dark' }) {
  const ref = useRef(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;
  const [state, setState] = useState('loading'); // loading | ready | off | error
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState('loading');
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.auth.config();
        if (!cfg.google_enabled) { if (!cancelled) setState('off'); return; }
        await loadGsi();
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
    return import.meta.env.DEV ? (
      <p className="google-hint">Google sign-in is off. Set <code>READVIBE_GOOGLE_CLIENT_ID</code> for the API to enable it.</p>
    ) : null;
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
