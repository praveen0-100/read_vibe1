// ─── Vibe's daily briefing: next-best actions from the reader's own rhythm, plus a mood check-in ──
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryLow, BookOpen, Brain, Clock, Compass, CloudRain, Flame, Meh, Moon, Smile, Sparkles, Upload, Wind } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { Skeleton } from '../ui';

const ICONS = { book: BookOpen, flame: Flame, brain: Brain, clock: Clock, moon: Moon, sparkles: Sparkles, compass: Compass, upload: Upload };
const MOODS = [
  { id: 'great', label: 'Great', icon: Smile },
  { id: 'okay', label: 'Okay', icon: Meh },
  { id: 'tired', label: 'Tired', icon: BatteryLow },
  { id: 'stressed', label: 'Stressed', icon: Wind },
  { id: 'low', label: 'Low', icon: CloudRain },
];

export default function BriefingCard({ compact = false }) {
  const { openAI, notify, dataVersion } = useApp();
  const navigate = useNavigate();
  const brief = useQuery(() => api.agent.briefing(), [dataVersion]);
  const [reply, setReply] = useState('');
  const b = brief.data;

  if (brief.loading && !b) return <Skeleton h={compact ? 150 : 130} r={14} />;
  if (!b) return null; // the briefing is an extra: if it can't load, the rest of Home still works

  const act = (cta) => {
    if (cta.action === 'open_doc') navigate(`/read/${cta.document_id}`);
    else if (cta.action === 'go') navigate(cta.to);
    else if (cta.action === 'open_tool') openAI({ documentId: cta.document_id, tool: cta.tool, nonce: Date.now() });
    else if (cta.action === 'ask') openAI({ documentId: cta.document_id, tab: 'chat', question: cta.question, nonce: Date.now() });
  };
  const checkin = async (mood) => {
    try {
      const r = await api.agent.checkin(mood);
      setReply(r.message);
      brief.reload();
    } catch (err) { notify(err.message, 'error'); }
  };

  const message = reply || (b.mood ? b.mood_reply : '');
  return (
    <section className={`briefing ${compact ? 'compact' : ''}`} aria-label="Your companion's briefing">
      <header className="briefing-head">
        <span className="briefing-mark"><Sparkles size={15} /></span>
        <div>
          <span className="eyebrow">VIBE · YOUR COMPANION</span>
          <h2>{b.greeting}{b.subline ? <small> — {b.subline}</small> : null}</h2>
        </div>
        <button className="secondary-button small" onClick={() => openAI({ tab: 'chat', nonce: Date.now() })}>Ask Vibe</button>
      </header>

      {b.needs_checkin && !reply ? (
        <div className="mood-row" role="group" aria-label="How are you feeling today?">
          <span>How are you feeling?</span>
          {MOODS.map(({ id, label, icon: Icon }) => (
            <button key={id} className="mood-chip" onClick={() => checkin(id)}><Icon size={14} /> {label}</button>
          ))}
        </div>
      ) : message ? <p className="mood-reply">{message}</p> : null}

      {b.cards.length > 0 && (
        <div className="briefing-cards">
          {b.cards.map((c) => {
            const Icon = ICONS[c.icon] || Sparkles;
            return (
              <article key={c.id} className={`briefing-item kind-${c.kind}`}>
                <span className="briefing-icon"><Icon size={16} /></span>
                <div className="briefing-text">
                  <strong>{c.title}</strong>
                  <p>{c.body}</p>
                  <small title="Why you're seeing this">{c.reason}</small>
                </div>
                {c.cta && <button className="secondary-button small" onClick={() => act(c.cta)}>{c.cta.label}</button>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
