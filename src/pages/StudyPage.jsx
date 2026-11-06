// ─── Study: spaced-repetition review (SM-2) ───────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Brain, CheckCircle2, EyeOff, Flame, Loader2, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { EmptyState, Field, Modal, Skeleton } from '../components/ui';

const GRADES = [
  { id: 'again', label: 'Again', hint: 'Forgot it — see it again in 10 minutes', key: '1' },
  { id: 'hard', label: 'Hard', hint: 'Remembered with effort', key: '2' },
  { id: 'good', label: 'Good', hint: 'Remembered', key: '3' },
  { id: 'easy', label: 'Easy', hint: 'Effortless — longer gap', key: '4' },
];

/** What happens next for each answer, so the buttons can say "1d / 6d / 15d" like a real SRS app. */
function previewDays(card, grade) {
  if (grade === 'again') return '10m';
  const reps = card.reps + 1;
  const base = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(card.interval_days + 1, Math.round(card.interval_days * card.ease * (grade === 'hard' ? 1.2 : 1) * (grade === 'easy' ? 1.3 : 1)));
  return `${base}d`;
}

function Stat({ icon: Icon, label, value }) {
  return <div className="st-stat"><Icon size={15} /><b>{value ?? '—'}</b><small>{label}</small></div>;
}

export default function StudyPage() {
  const { notify, dataVersion } = useApp();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const queue = useQuery(() => api.study.queue({ limit: 30 }), [version, dataVersion]);
  const stats = useQuery(() => api.study.stats(), [version, dataVersion]);
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ front: '', back: '' });

  const cards = useMemo(() => queue.data?.cards || [], [queue.data]);
  const card = cards[0];
  const reload = () => { setVersion((v) => v + 1); setFlipped(false); };

  const grade = useCallback(async (g) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await api.study.review(card.id, g);
      setDone((n) => n + 1);
      reload();
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  }, [card, busy, notify]);

  useEffect(() => {
    const onKey = (e) => {
      if (/input|textarea|select/i.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped(true); }
      if (flipped) { const g = GRADES.find((x) => x.key === e.key); if (g) grade(g.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, grade]);

  const make = async (fn, label) => {
    setBusy(true);
    try {
      const r = await fn();
      notify(r.created ? `Added ${r.created} ${label}` : `No new ${label} to add`, r.created ? 'success' : 'info');
      reload();
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const ready = (docs.data || []).filter((d) => d.status === 'ready');

  const addManual = async (e) => {
    e.preventDefault();
    try { await api.study.create(draft); setAdding(false); setDraft({ front: '', back: '' }); notify('Card added'); reload(); } catch (err) { notify(err.message, 'error'); }
  };

  const s = stats.data;
  return (
    <div className="page-shell study-page">
      <header className="topbar">
        <div><div className="eyebrow">STUDY</div><h1>Remember what you read.</h1></div>
        <div className="top-actions"><button className="primary-button" onClick={() => setAdding(true)}><Plus size={15} /> New card</button></div>
      </header>

      <div className="st-stats" aria-label="Study statistics">
        <Stat icon={Brain} label="due now" value={s?.due} />
        <Stat icon={Sparkles} label="new" value={s?.new} />
        <Stat icon={CheckCircle2} label="mature" value={s?.mature} />
        <Stat icon={Flame} label="day streak" value={s?.streak_days} />
        <Stat icon={RotateCcw} label="retention (30d)" value={s?.retention_30d == null ? null : `${Math.round(s.retention_30d * 100)}%`} />
      </div>

      {queue.loading && !queue.data ? <Skeleton h={260} /> : card ? (
        <section className="st-card-wrap" aria-live="polite">
          <div className="st-progress">{done} reviewed this session · {queue.data.due} due</div>
          <button className={`st-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(true)} aria-label={flipped ? 'Answer shown' : 'Show answer'}>
            <span className="st-side">{flipped ? 'ANSWER' : 'QUESTION'}</span>
            <span className="st-text">{flipped ? card.back : card.front}</span>
            {!flipped && <small>Press Space or tap to show the answer</small>}
          </button>
          {card.source?.chapter_index != null && card.document_id && (
            <button className="text-button" onClick={() => navigate(`/read/${card.document_id}`)}><BookOpen size={12} /> Open in the book</button>
          )}
          {flipped ? (
            <div className="st-grades" role="group" aria-label="How well did you remember?">
              {GRADES.map((g) => (
                <button key={g.id} className={`st-grade ${g.id}`} onClick={() => grade(g.id)} disabled={busy} title={g.hint}>
                  <strong>{g.label}</strong><small>{previewDays(card, g.id)}</small><kbd>{g.key}</kbd>
                </button>
              ))}
            </div>
          ) : (
            <div className="st-tools">
              <button className="text-button" onClick={async () => { await api.study.suspend(card.id); notify('Card hidden from reviews'); reload(); }}><EyeOff size={12} /> Hide card</button>
              <button className="text-button danger" onClick={async () => { await api.study.remove(card.id); reload(); }}><Trash2 size={12} /> Delete</button>
            </div>
          )}
        </section>
      ) : (
        <EmptyState icon={CheckCircle2} title={s?.total ? 'All caught up.' : 'No flashcards yet.'}
          description={s?.total ? 'Nothing is due right now. Come back later — the schedule decides when each card returns.' : 'Turn your highlights into cards, or generate term-and-definition cards from a document.'} />
      )}

      <section className="research-card st-make">
        <div className="section-top"><span className="eyebrow">MAKE CARDS FROM YOUR BOOKS</span></div>
        {ready.length === 0 && <p className="muted">Upload a document first.</p>}
        {ready.map((d) => (
          <div key={d.id} className="st-doc">
            <span>{d.title}</span>
            <button className="secondary-button sm" disabled={busy} onClick={() => make(() => api.study.fromHighlights(d.id), 'cards from highlights')}>From highlights</button>
            <button className="secondary-button sm" disabled={busy} onClick={() => make(() => api.study.fromDocument(d.id), 'term cards')}>Key terms</button>
          </div>
        ))}
        {busy && <Loader2 size={14} className="spin" />}
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="New flashcard" size="sm"
        footer={<><button className="secondary-button" onClick={() => setAdding(false)}>Cancel</button><button className="primary-button" form="newcard" disabled={!draft.front.trim() || !draft.back.trim()}>Add card</button></>}>
        <form id="newcard" className="stack" onSubmit={addManual}>
          <Field label="Question"><textarea className="input" rows={2} value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })} /></Field>
          <Field label="Answer"><textarea className="input" rows={3} value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} /></Field>
        </form>
      </Modal>
    </div>
  );
}
