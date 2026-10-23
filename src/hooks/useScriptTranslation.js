// Translates an audiobook's narration script (chapter titles + every segment) so the transcript and the voice follow
// the listener's chosen language. Segments keep their shape; only `text` / `title` change.
import { useEffect, useMemo, useState } from 'react';
import { translateTexts } from '../lib/translateClient';

export function useScriptTranslation(script, lang, sourceLang) {
  const active = !!script?.length && !!lang && lang !== 'orig' && lang !== sourceLang;
  const size = active ? script.reduce((n, c) => n + c.segments.length, 0) : 0;
  const key = active ? `${lang}|${script.length}|${size}` : null;
  const [state, setState] = useState({ key: null });

  useEffect(() => {
    if (!key) { setState({ key: null }); return undefined; }
    const ctl = new AbortController();
    setState({ key, running: true, done: 0, total: 1 });
    (async () => {
      const texts = [];
      script.forEach((ch) => { texts.push(ch.title || ''); ch.segments.forEach((s) => texts.push(s.text || '')); });
      const { out, note } = await translateTexts(texts, lang, sourceLang, {
        signal: ctl.signal,
        onProgress: (done, total) => setState((s) => (s.key === key ? { ...s, done, total: Math.max(1, total) } : s)),
      });
      if (ctl.signal.aborted) return;
      let n = 0;
      const next = script.map((ch) => {
        const title = out[n] || ch.title; n += 1;
        const segments = ch.segments.map((s) => { const t = out[n] || s.text; n += 1; return { ...s, text: t }; });
        return { ...ch, title, segments };
      });
      setState({ key, running: false, script: next, note });
    })().catch((err) => { if (!ctl.signal.aborted) setState({ key, running: false, error: err.message || 'Translation failed' }); });
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = state.key === key && !!state.script;
  return {
    script: ready ? state.script : script,
    status: {
      active, ready, running: active && (state.key !== key || !!state.running),
      progress: state.key === key && state.total ? Math.round((state.done / state.total) * 100) : 0,
      note: ready ? state.note : null, error: state.key === key ? state.error : null,
    },
  };
}
