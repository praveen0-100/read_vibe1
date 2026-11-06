// Look Up sheet: dictionary entry + Wikipedia summary for the selected word or phrase.
import React, { useEffect, useRef, useState } from 'react';
import { BookA, ExternalLink, Globe, Loader2, Sparkles, Volume2, X } from 'lucide-react';
import { api } from '../../api/client';
import { speak } from '../../lib/speech';

export default function LookUpSheet({ term, lang = 'en', onClose, onExplain }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const phrase = term.trim().split(/\s+/).length > 3;

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    api.lookup(term, lang).then((r) => live && setData(r)).catch((e) => live && setError(e.message || 'Look up is unavailable right now'));
    return () => { live = false; };
  }, [term, lang]);
  useEffect(() => { ref.current?.focus(); }, []);

  const pronounce = () => {
    if (data?.dictionary?.audio) new Audio(data.dictionary.audio).play().catch(() => speak(data.dictionary.word));
    else speak(term);
  };

  return (
    <div className="lookup-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lookup-sheet" role="dialog" aria-modal="true" aria-label={`Look up ${term}`} ref={ref} tabIndex={-1} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header>
          <strong className="lk-term">{term.length > 60 ? `${term.slice(0, 60)}…` : term}</strong>
          <button onClick={pronounce} aria-label="Pronounce"><Volume2 size={17} /></button>
          <button onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        <div className="lk-body">
          {!data && !error && <p className="muted"><Loader2 size={14} className="spin" /> Looking up…</p>}
          {error && <p className="field-error">{error}</p>}
          {data && (
            <>
              <section>
                <h4><BookA size={14} /> Dictionary</h4>
                {data.dictionary ? (
                  <>
                    {data.dictionary.phonetic && <small className="lk-phon">{data.dictionary.phonetic}</small>}
                    {data.dictionary.meanings.map((m, i) => (
                      <div key={i} className="lk-meaning"><em>{m.pos}</em><ol>{m.defs.map((d, j) => <li key={j}>{d}</li>)}</ol></div>
                    ))}
                  </>
                ) : <p className="muted">{data.dictionary_skipped ? (phrase ? 'Definitions are shown for single words — select one word to see its dictionary entry.' : 'The dictionary covers English words.') : 'No dictionary entry found.'}</p>}
              </section>
              <section>
                <h4><Globe size={14} /> Wikipedia</h4>
                {data.wikipedia ? (
                  <>
                    <strong>{data.wikipedia.title}</strong>
                    <p>{data.wikipedia.extract}</p>
                    {data.wikipedia.url && <a href={data.wikipedia.url} target="_blank" rel="noreferrer noopener" className="text-button">Read more <ExternalLink size={12} /></a>}
                  </>
                ) : <p className="muted">{data.errors?.includes('wikipedia') ? 'Wikipedia could not be reached.' : 'No Wikipedia article for this.'}</p>}
              </section>
              {(phrase || (!data.dictionary && !data.wikipedia)) && onExplain && (
                <button className="secondary-button" onClick={() => onExplain(term)}><Sparkles size={14} /> Explain with AI</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
