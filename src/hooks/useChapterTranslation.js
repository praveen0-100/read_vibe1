// Shows a chapter in another language: returns the chapter with its title and paragraphs translated,
// so the page, the read-aloud script and the transcript all follow the reader's chosen language.
import { useEffect, useMemo, useState } from 'react';
import { translateTexts } from '../lib/translateClient';
import { splitParagraphs } from '../components/reader/ChapterText';

const HEADING = /^#{1,3}\s+/;

export function useChapterTranslation(raw, lang, sourceLang) {
  const active = !!raw && !!lang && lang !== 'orig' && lang !== sourceLang;
  const key = active ? `${raw.index ?? raw.title}|${lang}|${raw.content.length}` : null;
  const [state, setState] = useState({ key: null });

  useEffect(() => {
    if (!key) { setState({ key: null }); return undefined; }
    const ctl = new AbortController();
    setState({ key, running: true, done: 0, total: 1 });
    (async () => {
      const paras = splitParagraphs(raw.content);
      const marks = paras.map((p) => (p.length < 70 && HEADING.test(p) ? p.match(HEADING)[0] : ''));
      const texts = [raw.title || '', ...paras.map((p, i) => p.slice(marks[i].length))];
      const { out, note } = await translateTexts(texts, lang, sourceLang, {
        signal: ctl.signal,
        onProgress: (done, total) => setState((s) => (s.key === key ? { ...s, done, total: Math.max(1, total) } : s)),
      });
      if (ctl.signal.aborted) return;
      const body = paras.map((p, i) => (out[i + 1] ? marks[i] + out[i + 1] : p));
      setState({
        key, running: false, content: body.join('\n\n'), title: out[0] || raw.title, note,
        missing: out.filter((t, i) => t === null && texts[i]).length,
      });
    })().catch((err) => { if (!ctl.signal.aborted) setState({ key, running: false, error: err.message || 'Translation failed' }); });
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = state.key === key && state.content != null;
  const chapter = useMemo(
    () => (ready ? { ...raw, title: state.title, content: state.content, translated: true } : raw),
    [ready, raw, state.title, state.content],
  );
  return {
    chapter,
    status: {
      active, ready, running: active && (state.key !== key || !!state.running),
      progress: state.key === key && state.total ? Math.round((state.done / state.total) * 100) : 0,
      note: ready ? state.note : null, error: state.key === key ? state.error : null, missing: ready ? state.missing : 0,
    },
  };
}
