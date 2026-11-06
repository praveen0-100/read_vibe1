// Audience Q&A for the presenter: answers from the slide on screen and the deck's source document, with citations.
import React, { useState } from 'react';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';

export default function AudienceQA({ deckId, slideIndex }) {
  const { notify, prefs } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const ask = async (e) => {
    e.preventDefault();
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    try {
      const language = prefs.languages?.ai && prefs.languages.ai !== 'auto' ? prefs.languages.ai : undefined;
      const res = await api.decks.ask(deckId, { question, slide_index: slideIndex, language });
      setLog((l) => [{ question, slide: slideIndex + 1, ...res }, ...l].slice(0, 6));
      setQ('');
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <section className="dkp-card dkp-qa" aria-label="Audience questions">
      <span className="eyebrow"><MessageCircleQuestion size={12} /> AUDIENCE Q&amp;A</span>
      <form onSubmit={ask} className="dkp-qa-form">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="Ask about this slide…" aria-label="Audience question" />
        <button className="icon-ghost sm" disabled={busy || q.trim().length < 3} aria-label="Ask">{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}</button>
      </form>
      {log.map((m, i) => (
        <div key={i} className="dkp-qa-item">
          <b>Q (slide {m.slide}): {m.question}</b>
          <p>{m.answer}</p>
          {m.citations?.length > 0 && (
            <small>Source: {m.citations.map((c) => `${c.chapter_title}${c.page ? `, p. ${c.page}` : ''}`).join(' · ')}</small>
          )}
          {!m.grounded && <small className="muted">Not covered by the source — treat as a follow-up.</small>}
        </div>
      ))}
    </section>
  );
}
