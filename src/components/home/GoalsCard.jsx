// Reading goals: today's progress ring, goal streak, weekly target, cards due vs goal, and a 12-week activity heatmap.
import React, { useState } from 'react';
import { Flame, Pencil, Target } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { Modal, Field } from '../ui';

function Ring({ percent, label, sub }) {
  const r = 34; const c = 2 * Math.PI * r;
  return (
    <div className="gc-ring" role="img" aria-label={`${label}: ${percent}% of today's goal`}>
      <svg viewBox="0 0 80 80" width="84" height="84">
        <circle cx="40" cy="40" r={r} className="gc-track" />
        <circle cx="40" cy="40" r={r} className="gc-fill" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(100, percent) / 100) }} transform="rotate(-90 40 40)" />
      </svg>
      <div className="gc-ring-text"><b>{label}</b><small>{sub}</small></div>
    </div>
  );
}

/** 0 = none … 4 = at/over twice the goal, so colour always reads relative to the reader's own target. */
const level = (m, goal) => (m <= 0 ? 0 : m < goal * 0.5 ? 1 : m < goal ? 2 : m < goal * 2 ? 3 : 4);

export default function GoalsCard() {
  const { notify, dataVersion } = useApp();
  const [version, setVersion] = useState(0);
  const tz = new Date().getTimezoneOffset();
  const p = useQuery(() => api.goals.progress(tz), [version, dataVersion]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const d = p.data;
  if (!d) return null;

  const open = () => { setDraft({ ...d.goals }); setEditing(true); };
  const save = async (e) => {
    e.preventDefault();
    try { await api.goals.set({ daily_minutes: +draft.daily_minutes, weekly_days: +draft.weekly_days, cards_per_day: +draft.cards_per_day }); setEditing(false); setVersion((v) => v + 1); notify('Goals updated'); } catch (err) { notify(err.message, 'error'); }
  };
  const weeks = [];
  for (let i = 0; i < d.heatmap.length; i += 7) weeks.push(d.heatmap.slice(i, i + 7));

  return (
    <section className="goals-card" aria-label="Reading goals">
      <header>
        <span className="eyebrow"><Target size={12} /> DAILY GOAL</span>
        <button className="icon-ghost sm" onClick={open} aria-label="Edit goals"><Pencil size={14} /></button>
      </header>
      <div className="gc-main">
        <Ring percent={d.today.percent} label={`${d.today.minutes}m`} sub={`of ${d.today.goal}m`} />
        <ul className="gc-facts">
          <li className={d.streak ? 'hot' : ''}><Flame size={14} /> <b>{d.streak}</b> day streak <small>best {d.longest_streak}</small></li>
          <li><b>{d.week.days_met}/{d.week.goal}</b> days this week {d.week.met && <span className="gc-badge">goal met</span>}</li>
          {d.today.cards_goal > 0 && <li><b>{d.today.cards}/{d.today.cards_goal}</b> cards today {d.today.cards_met && <span className="gc-badge">done</span>}</li>}
        </ul>
      </div>
      <div className="gc-heat" role="img" aria-label={`Activity over the last 12 weeks: ${d.active_days_84} active days`}>
        {weeks.map((w, i) => (
          <div key={i}>{w.map((day) => <i key={day.date} className={`l${level(day.minutes, d.today.goal)}`} title={`${day.date}: ${day.minutes} min`} />)}</div>
        ))}
      </div>
      <small className="gc-note">{d.today.met ? 'Goal reached today — nice.' : `${Math.max(0, d.today.goal - d.today.minutes)} more minutes to reach today’s goal.`}</small>

      {editing && draft && (
        <Modal open onClose={() => setEditing(false)} title="Your goals" size="sm"
          footer={<><button className="secondary-button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" form="goalsform">Save</button></>}>
          <form id="goalsform" className="stack" onSubmit={save}>
            <Field label="Minutes per day" hint="Reading, focus and listening all count"><input className="input" type="number" min="5" max="600" required value={draft.daily_minutes} onChange={(e) => setDraft({ ...draft, daily_minutes: e.target.value })} /></Field>
            <Field label="Days per week"><input className="input" type="number" min="1" max="7" required value={draft.weekly_days} onChange={(e) => setDraft({ ...draft, weekly_days: e.target.value })} /></Field>
            <Field label="Flashcards per day" hint="0 turns the card goal off"><input className="input" type="number" min="0" max="200" required value={draft.cards_per_day} onChange={(e) => setDraft({ ...draft, cards_per_day: e.target.value })} /></Field>
          </form>
        </Modal>
      )}
    </section>
  );
}
