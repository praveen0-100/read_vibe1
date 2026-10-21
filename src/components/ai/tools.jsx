// ─── AI tool views (rendered inside the AI panel) ────────────────────────────
import React, { useEffect, useState } from 'react';
import {
  BookmarkPlus, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, GitCompare, Lightbulb,
  RotateCcw, Shuffle, Sparkles, Volume2, X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { speak } from '../../lib/speech';
import { ErrorState, RichText, Segmented } from '../ui';

const STAGES = {
  summary: ['Reading the document…', 'Finding the main ideas…', 'Writing your summary…'],
  quiz: ['Reading the chapter…', 'Choosing key concepts…', 'Writing questions…'],
  generic: ['Reading the document…', 'Understanding content…', 'Generating response…'],
};

/** Runs an AI request with staged loading copy. */
export function useAIRequest() {
  const [state, setState] = useState({ loading: false, data: null, error: null, stage: '' });
  const run = async (fn, stages = STAGES.generic) => {
    setState({ loading: true, data: null, error: null, stage: stages[0] });
    let i = 0;
    const timer = setInterval(() => { i = Math.min(stages.length - 1, i + 1); setState((s) => ({ ...s, stage: stages[i] })); }, 900);
    try {
      const data = await fn();
      setState({ loading: false, data, error: null, stage: '' });
      return data;
    } catch (error) {
      setState({ loading: false, data: null, error, stage: '' });
      return null;
    } finally {
      clearInterval(timer);
    }
  };
  return [state, run, setState];
}

export function AILoading({ stage }) {
  return (
    <div className="ai-loading" role="status" aria-live="polite">
      <div className="ai-orb"><Sparkles size={18} /></div>
      <span>{stage}</span>
    </div>
  );
}

function EngineBadge({ engine }) {
  if (!engine) return null;
  return <span className="engine-badge" title="Which engine produced this result">{engine === 'local' ? 'ReadVibe engine · grounded in your text' : engine}</span>;
}

export function ResultActions({ onSave, onRegenerate, copyText, extra }) {
  const { notify } = useApp();
  return (
    <div className="result-actions">
      {onSave && <button className="secondary-button small" onClick={onSave}><BookmarkPlus size={13} /> Save to notes</button>}
      {copyText && <button className="secondary-button small" onClick={() => navigator.clipboard?.writeText(copyText).then(() => notify('Copied to clipboard'))}><Copy size={13} /> Copy</button>}
      {onRegenerate && <button className="secondary-button small" onClick={onRegenerate}><RotateCcw size={13} /> Regenerate</button>}
      {extra}
    </div>
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
const DEPTHS = [
  { id: 'brief', label: 'Brief', sub: 'The essentials in a minute' },
  { id: 'standard', label: 'Standard', sub: 'Main concepts with context' },
  { id: 'deep', label: 'Deep dive', sub: 'Full detail for study' },
];

export function SummaryView({ ctx, saveNote, askChat }) {
  const [depth, setDepth] = useState('standard');
  const [state, run] = useAIRequest();
  const generate = (d = depth) => run(() => api.ai.summarize(ctx.documentId, ctx.chapterIndex, d), STAGES.summary);
  const s = state.data;
  const asText = s ? `${s.main_idea}\n\n${s.key_points.map((p) => `• ${p}`).join('\n')}\n\nTakeaway: ${s.takeaways}` : '';

  return (
    <div className="ai-view">
      <div className="depth-selector" role="radiogroup" aria-label="Summary depth">
        {DEPTHS.map((d) => (
          <button key={d.id} role="radio" aria-checked={depth === d.id} className={`depth-btn ${depth === d.id ? 'active' : ''}`}
            onClick={() => { setDepth(d.id); if (s) generate(d.id); }}>
            <strong>{d.label}</strong><small>{d.sub}</small>
          </button>
        ))}
      </div>
      {!s && !state.loading && <button className="primary-button full-width" onClick={() => generate()}><Sparkles size={15} /> Summarize {ctx.scopeLabel}</button>}
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={() => generate()} compact />}
      {s && !state.loading && (
        <div className="summary-output">
          <EngineBadge engine={s.engine} />
          <section><div className="summary-label">MAIN IDEA</div><p className="main-idea">{s.main_idea}</p></section>
          <section>
            <div className="summary-label">KEY POINTS</div>
            <ul className="key-points">{s.key_points.map((p, i) => <li key={i}><Check size={13} />{p}</li>)}</ul>
          </section>
          {s.concepts?.length > 0 && (
            <section>
              <div className="summary-label">IMPORTANT CONCEPTS</div>
              <div className="concept-pills">{s.concepts.map((c) => <button key={c} className="concept-pill" onClick={() => askChat(`Explain “${c}” as the text uses it.`)}>{c}</button>)}</div>
            </section>
          )}
          {s.examples?.length > 0 && (
            <section><div className="summary-label">EXAMPLES</div>{s.examples.map((e, i) => <blockquote key={i} className="ai-quote">{e}</blockquote>)}</section>
          )}
          <section><div className="summary-label">KEY TAKEAWAY</div><p className="takeaway">{s.takeaways}</p></section>
          <section>
            <div className="summary-label">EXPLORE FURTHER</div>
            {s.suggested_questions.map((q) => <button key={q} className="suggested-q" onClick={() => askChat(q)}>→ {q}</button>)}
          </section>
          <ResultActions copyText={asText} onRegenerate={() => generate()}
            onSave={() => saveNote({ title: `${DEPTHS.find((d) => d.id === depth).label} summary · ${ctx.scopeTitle}`, content: asText, category: 'AI Insight', note_type: 'summary', ai_payload: s })} />
        </div>
      )}
    </div>
  );
}

// ─── Explain ──────────────────────────────────────────────────────────────────
const MODES = [
  { value: 'simple', label: 'Simple' },
  { value: 'student', label: 'Student' },
  { value: 'expert', label: 'Expert' },
  { value: 'example', label: 'Example' },
  { value: 'analogy', label: 'Analogy' },
];

export function ExplainView({ ctx, saveNote }) {
  const [text, setText] = useState(ctx.selection || '');
  const [mode, setMode] = useState('simple');
  const [state, run] = useAIRequest();
  const go = (m = mode) => text.trim() && run(() => api.ai.explain(text.trim(), m, ctx.documentId));
  useEffect(() => { if (ctx.selection) { setText(ctx.selection); run(() => api.ai.explain(ctx.selection, 'simple', ctx.documentId)); } }, [ctx.selection]); // eslint-disable-line
  const r = state.data;
  return (
    <div className="ai-view">
      <label className="field">
        <span className="field-label">Text to explain</span>
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Select text in the reader, or paste a sentence or concept here…" />
      </label>
      <Segmented size="sm" value={mode} onChange={(m) => { setMode(m); if (r) go(m); }} options={MODES} label="Explanation style" />
      {!r && !state.loading && <button className="primary-button full-width" onClick={() => go()} disabled={!text.trim()}><Lightbulb size={15} /> Explain</button>}
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={() => go()} compact />}
      {r && !state.loading && (
        <div className="summary-output">
          <EngineBadge engine={r.engine} />
          <RichText text={r.explanation} className="explanation" />
          {r.key_terms?.length > 0 && (
            <section>
              <div className="summary-label">KEY TERMS</div>
              <dl className="term-list">{r.key_terms.map((t) => <div key={t.term}><dt>{t.term}</dt><dd>{t.definition}</dd></div>)}</dl>
            </section>
          )}
          {r.related_passages?.length > 0 && (
            <section><div className="summary-label">RELATED IN THE TEXT</div>{r.related_passages.map((p, i) => <blockquote key={i} className="ai-quote">{p}</blockquote>)}</section>
          )}
          <ResultActions copyText={r.explanation} onRegenerate={() => go()}
            extra={<button className="secondary-button small" onClick={() => speak(r.explanation.replace(/\*/g, ''))}><Volume2 size={13} /> Listen</button>}
            onSave={() => saveNote({ title: `Explained (${mode}): ${text.slice(0, 60)}`, quote: text, content: r.explanation, category: 'AI Insight', note_type: 'explanation', ai_payload: r })} />
        </div>
      )}
    </div>
  );
}

// ─── Define ───────────────────────────────────────────────────────────────────
export function DefineView({ ctx, saveNote }) {
  const [term, setTerm] = useState((ctx.selection || '').split(/\s+/).slice(0, 3).join(' '));
  const [state, run] = useAIRequest();
  const go = () => term.trim() && run(() => api.ai.define(term.trim(), ctx.documentId));
  useEffect(() => { if (term) go(); }, []); // eslint-disable-line
  const r = state.data;
  const playAudio = () => { if (r?.audio) new Audio(r.audio).play().catch(() => speak(r.term)); else speak(r.term); };
  return (
    <div className="ai-view">
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Word or phrase" aria-label="Term to define" />
        <button className="primary-button" disabled={!term.trim()}>Define</button>
      </form>
      {state.loading && <AILoading stage="Looking it up…" />}
      {state.error && <ErrorState error={state.error} onRetry={go} compact />}
      {r && !state.loading && (
        <div className="summary-output">
          <div className="define-head">
            <h3>{r.term}</h3>
            {r.phonetic && <span className="muted">{r.phonetic}</span>}
            <button className="icon-ghost sm" onClick={playAudio} aria-label="Pronounce"><Volume2 size={15} /></button>
          </div>
          {r.dictionary.length > 0 ? (
            <ol className="def-list">{r.dictionary.map((d, i) => (
              <li key={i}><em>{d.part_of_speech}</em> {d.definition}{d.example && <small>“{d.example}”</small>}</li>
            ))}</ol>
          ) : <p className="muted small">No dictionary entry found{r.term.includes(' ') ? ' for this phrase' : ''}.</p>}
          {r.in_document.length > 0 && (
            <section><div className="summary-label">HOW THIS DOCUMENT USES IT</div>{r.in_document.map((s, i) => <blockquote key={i} className="ai-quote">{s}</blockquote>)}</section>
          )}
          <ResultActions onSave={() => saveNote({
            title: `Vocabulary: ${r.term}`, category: 'Definition', note_type: 'note',
            content: [r.dictionary[0] && `${r.dictionary[0].part_of_speech}: ${r.dictionary[0].definition}`, r.in_document[0] && `In the text: ${r.in_document[0]}`].filter(Boolean).join('\n\n'),
          })} />
        </div>
      )}
    </div>
  );
}

// ─── Quiz & flashcards ────────────────────────────────────────────────────────
export function QuizView({ ctx, saveNote }) {
  const { notify } = useApp();
  const [state, run] = useAIRequest();
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState(false);
  const [grades, setGrades] = useState({});
  const [mode, setMode] = useState('quiz');
  const [card, setCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [order, setOrder] = useState([]);
  const generate = async () => {
    setAnswers({}); setChecked(false); setGrades({}); setCard(0); setFlipped(false);
    const d = await run(() => api.ai.quiz(ctx.documentId, ctx.chapterIndex, 6), STAGES.quiz);
    if (d) setOrder(d.flashcards.map((_, i) => i));
  };
  const q = state.data;
  const objective = q?.questions.filter((x) => x.type !== 'short_answer') || [];
  const score = objective.filter((x) => answers[x.id] === x.correct).length;

  const check = async () => {
    setChecked(true);
    const short = q.questions.filter((x) => x.type === 'short_answer' && answers[x.id]?.trim());
    const results = await Promise.all(short.map((x) => api.ai.grade(answers[x.id], x.answer).catch(() => null)));
    const g = {};
    short.forEach((x, i) => { if (results[i]) g[x.id] = results[i]; });
    setGrades(g);
  };

  const cards = q?.flashcards || [];
  const current = cards[order[card]];

  return (
    <div className="ai-view">
      {!q && !state.loading && <button className="primary-button full-width" onClick={generate}><Sparkles size={15} /> Generate quiz & flashcards for {ctx.scopeLabel}</button>}
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={generate} compact />}
      {q && !state.loading && (
        <>
          <Segmented size="sm" value={mode} onChange={setMode} label="Study mode" options={[
            { value: 'quiz', label: `Quiz (${q.questions.length})` },
            { value: 'cards', label: `Flashcards (${cards.length})` },
          ]} />
          {mode === 'quiz' ? (
            <div className="quiz-view">
              {q.questions.length === 0 && <p className="muted">This section is too short to build a quiz. Try the whole document.</p>}
              {q.questions.map((x, qi) => (
                <div key={x.id} className="quiz-question">
                  <div className="q-number">Q{qi + 1} · {x.type.replace('_', ' ')}</div>
                  <p className="q-text">{x.question}</p>
                  {x.type !== 'short_answer' ? (
                    <div className="q-options">
                      {x.options.map((opt, oi) => {
                        const cls = checked ? (oi === x.correct ? 'correct' : answers[x.id] === oi ? 'wrong' : '') : answers[x.id] === oi ? 'selected' : '';
                        return (
                          <button key={oi} className={`q-option ${cls}`} disabled={checked} onClick={() => setAnswers((a) => ({ ...a, [x.id]: oi }))} aria-pressed={answers[x.id] === oi}>
                            <span className="opt-letter">{String.fromCharCode(65 + oi)}</span>{opt}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea className="input" rows={3} placeholder={x.hint || 'Your answer…'} disabled={checked}
                      value={answers[x.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [x.id]: e.target.value }))} />
                  )}
                  {checked && (
                    <div className="q-feedback">
                      {x.type === 'short_answer' ? (
                        <>
                          {grades[x.id] && <strong>{Math.round(grades[x.id].score * 100)}% · {grades[x.id].feedback}</strong>}
                          <p><em>Model answer:</em> {x.answer}</p>
                        </>
                      ) : <p>{x.explanation}</p>}
                    </div>
                  )}
                </div>
              ))}
              {!checked ? (
                <button className="primary-button full-width" onClick={check} disabled={!Object.keys(answers).length}>
                  Check answers ({Object.keys(answers).length}/{q.questions.length})
                </button>
              ) : (
                <div className="quiz-score">
                  <strong>{score}/{objective.length}</strong>
                  <span>{score === objective.length ? 'Perfect — you know this chapter!' : score >= objective.length / 2 ? 'Good work — review the misses below.' : 'Worth another read — then try again.'}</span>
                  <div className="result-actions">
                    <button className="secondary-button small" onClick={() => { setAnswers({}); setChecked(false); setGrades({}); }}><RotateCcw size={13} /> Retry</button>
                    <button className="secondary-button small" onClick={generate}><Sparkles size={13} /> New questions</button>
                    <button className="secondary-button small" onClick={() => saveNote({
                      title: `Quiz result · ${ctx.scopeTitle}`, category: 'Exam', note_type: 'quiz', ai_payload: q,
                      content: `Scored ${score}/${objective.length}.\n\n${q.questions.map((x, i) => `${i + 1}. ${x.question}\n   ${x.type === 'short_answer' ? x.answer : x.options[x.correct]}`).join('\n')}`,
                    })}><BookmarkPlus size={13} /> Save</button>
                  </div>
                </div>
              )}
            </div>
          ) : cards.length === 0 ? (
            <p className="muted">No definitions were found to build flashcards from this section.</p>
          ) : (
            <div className="flashcards">
              <button className={`flashcard ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show term' : 'Reveal definition'}>
                <div className="fc-face fc-front"><small>TERM</small><strong>{current?.front}</strong><span>Tap to reveal</span></div>
                <div className="fc-face fc-back"><small>FROM THE TEXT</small><p>{current?.back}</p></div>
              </button>
              <div className="fc-controls">
                <button className="icon-ghost" onClick={() => { setCard((c) => Math.max(0, c - 1)); setFlipped(false); }} disabled={card === 0} aria-label="Previous card"><ChevronLeft size={18} /></button>
                <span>{card + 1} / {cards.length}</span>
                <button className="icon-ghost" onClick={() => { setCard((c) => Math.min(cards.length - 1, c + 1)); setFlipped(false); }} disabled={card === cards.length - 1} aria-label="Next card"><ChevronRight size={18} /></button>
                <button className="icon-ghost" onClick={() => { setOrder((o) => [...o].sort(() => Math.random() - 0.5)); setCard(0); setFlipped(false); }} aria-label="Shuffle"><Shuffle size={16} /></button>
              </div>
              <button className="secondary-button full" onClick={() => {
                Promise.all(cards.map((c) => api.notes.create({ title: c.front, content: c.back, category: 'Definition', note_type: 'flashcard', document_id: ctx.documentId, chapter_index: ctx.chapterIndex ?? null })))
                  .then(() => notify(`${cards.length} flashcards saved to your notebook`)).catch((e) => notify(e.message, 'error'));
              }}><BookmarkPlus size={13} /> Save all flashcards</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Visual references ────────────────────────────────────────────────────────
export function VisualView({ ctx, saveNote, defaultQuery }) {
  const [query, setQuery] = useState(ctx.selection?.split(/\s+/).slice(0, 6).join(' ') || defaultQuery || '');
  const [state, run] = useAIRequest();
  const [zoom, setZoom] = useState(null);
  const go = () => query.trim() && run(() => api.ai.visual(query.trim()), ['Searching open image libraries…']);
  useEffect(() => { if (query) go(); }, []); // eslint-disable-line
  const r = state.data;
  return (
    <div className="ai-view">
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Concept to visualise, e.g. “mental model”" aria-label="Visual search" />
        <button className="primary-button" disabled={!query.trim()}>Search</button>
      </form>
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={go} compact />}
      {r?.error && <p className="muted small">{r.error}</p>}
      {r && !state.loading && r.results.length === 0 && !r.error && <p className="muted">No open-licensed images found. Try a broader concept.</p>}
      {r && r.results.length > 0 && (
        <div className="visual-grid">
          {r.results.map((v, i) => (
            <figure key={i} className="visual-card">
              {v.image ? <button className="visual-img" onClick={() => setZoom(v)}><img src={v.image} alt={v.title} loading="lazy" /></button> : <div className="visual-noimg">{v.title}</div>}
              <figcaption>
                <strong>{v.title}</strong>
                {v.summary && <p>{v.summary}</p>}
                <div className="visual-meta">
                  <span>{v.source}</span>
                  {v.url && <a href={v.url} target="_blank" rel="noreferrer noopener">Source <ExternalLink size={11} /></a>}
                  <button className="text-button" onClick={() => saveNote({ title: `Visual: ${v.title}`, content: `${v.summary || ''}\n\nImage: ${v.image || ''}\nSource: ${v.url || v.source}`, category: 'Research', note_type: 'note', ai_payload: v })}>Save</button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.title}>
          <img src={zoom.image} alt={zoom.title} />
          <p>{zoom.title} · {zoom.source}</p>
          <button className="icon-ghost" aria-label="Close"><X size={18} /></button>
        </div>
      )}
      <p className="fineprint">Images come from Wikipedia and Wikimedia Commons. Check each source’s licence before reusing.</p>
    </div>
  );
}

// ─── Compare concepts ─────────────────────────────────────────────────────────
export function CompareView({ ctx, saveNote }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [state, run] = useAIRequest();
  const go = () => a.trim() && b.trim() && run(() => api.ai.compare({ document_id: ctx.documentId, chapter_index: ctx.chapterIndex, concept_a: a.trim(), concept_b: b.trim() }));
  const r = state.data;
  return (
    <div className="ai-view">
      <form className="compare-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className="input" value={a} onChange={(e) => setA(e.target.value)} placeholder="First concept" aria-label="First concept" />
        <GitCompare size={16} className="muted" />
        <input className="input" value={b} onChange={(e) => setB(e.target.value)} placeholder="Second concept" aria-label="Second concept" />
        <button className="primary-button" disabled={!a.trim() || !b.trim()}>Compare</button>
      </form>
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={go} compact />}
      {r && !state.loading && (
        <div className="summary-output">
          <EngineBadge engine={r.engine} />
          <RichText text={r.summary} />
          <div className="compare-cols">
            {[r.a, r.b].map((side) => (
              <section key={side.concept}>
                <div className="summary-label">{side.concept.toUpperCase()}</div>
                {side.evidence.length ? side.evidence.map((e, i) => <blockquote key={i} className="ai-quote">{e}</blockquote>) : <p className="muted small">Not mentioned in this scope.</p>}
              </section>
            ))}
          </div>
          <ResultActions onSave={() => saveNote({ title: `${r.a.concept} vs ${r.b.concept}`, content: r.summary, category: 'AI Insight', note_type: 'ai_insight', ai_payload: r })} />
        </div>
      )}
      {!r && !state.loading && <p className="muted small">Compare two ideas using evidence from the document — useful for exam answers.</p>}
    </div>
  );
}
