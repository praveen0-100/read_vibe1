// Settings → AI engine: which model answers, whether it is reachable right now, and how to switch Groq on.
import React, { useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Zap } from 'lucide-react';
import { api } from '../../api/client';
import { useQuery } from '../../hooks/useAsync';

export default function AIEngine() {
  const status = useQuery(() => api.ai.status(), []);
  const [test, setTest] = useState(null); // { loading } | result
  const s = status.data;
  const backup = !!(test?.ok && s?.groq && !String(test.provider).startsWith('Groq'));
  const groqError = s?.providers?.find((p) => p.name === 'groq')?.last_error;
  const run = async () => {
    setTest({ loading: true });
    try { setTest(await api.ai.test()); } catch (e) { setTest({ ok: false, detail: e.message }); }
    status.reload();
  };
  return (
    <section className="setting-section ai-engine">
      <div><h2>AI engine</h2><p>One model answers summaries, explanations, meanings, chat, mind maps, quizzes, slides and translation.</p></div>
      <div className="setting-rows">
        <div className="ae-now">
          <span className={`ae-dot ${s?.groq ? 'on' : ''}`} aria-hidden="true" />
          <div>
            <strong>{s ? (s.llm ? s.provider : 'Built-in engine (no network AI)') : 'Checking…'}</strong>
            <small>{s?.groq ? 'Groq is the primary model. The free public endpoints and the built-in engine back it up.' : 'Groq is not configured. Free public endpoints answer, with the built-in engine as a last resort.'}</small>
          </div>
          <button className="secondary-button small" onClick={run} disabled={test?.loading}>{test?.loading ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} Test now</button>
        </div>
        {test && !test.loading && (
          <p className={`ae-result ${test.ok && !backup ? 'ok' : 'bad'}`} role="status">
            {test.ok && !backup ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
            {!test.ok ? (test.detail || 'The AI did not answer.')
              : backup ? `Groq did not answer — ${test.provider} did (${test.ms} ms). ${groqError || 'Check the Groq key in backend/.env.'}`
              : `${test.provider} answered in ${test.ms} ms.`}
          </p>
        )}
        {s?.providers?.length > 0 && (
          <ul className="ae-list">
            {s.providers.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b> <span>{p.model}</span>
                {p.cooling_down_s > 0 && <em>paused {p.cooling_down_s}s</em>}
                {p.last_error && <small>{p.last_error}</small>}
              </li>
            ))}
          </ul>
        )}
        {s && !s.groq && (
          <p className="ae-how">To use Groq, create a key at console.groq.com and add <code>READVIBE_GROQ_API_KEY=your-key</code> to <code>backend/.env</code> (on Render: an environment variable), then restart the API.</p>
        )}
      </div>
    </section>
  );
}
