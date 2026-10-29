// ─── Settings → Companion: personalisation switch, tone, and everything Vibe knows (viewable, deletable) ──
import React, { useState } from 'react';
import { Cpu, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { Segmented, Spinner, Switch } from '../ui';

const KIND_LABEL = { goal: 'Goal', preference: 'Preference', interest: 'Interest', struggle: 'Finds hard', fact: 'Note' };

function Row({ title, description, children }) {
  return (
    <div className="setting-row-block">
      <div><strong>{title}</strong>{description && <small>{description}</small>}</div>
      <div>{children}</div>
    </div>
  );
}

function Known({ profile }) {
  const { behavior: b, cognitive: c, wellbeing: w } = profile;
  const facts = [];
  if (b.sessions) {
    facts.push(`You read about ${b.minutes_30d} minutes across ${b.active_days_30d} of the last 30 days (about ${b.avg_session_min} min a session).`);
    if (b.peak_label) facts.push(`Most of your focused time is ${b.peak_label}.`);
    if (b.preferred_mode) facts.push(`You usually read in ${b.preferred_mode} mode.`);
    if (b.streak) facts.push(`Current streak: ${b.streak} day${b.streak === 1 ? '' : 's'}.`);
  }
  if (c.pace_wpm) facts.push(`Estimated reading pace: about ${c.pace_wpm} words per minute (${c.pace_label}).`);
  if (c.quiz_attempts) facts.push(`${c.quiz_attempts} quiz result${c.quiz_attempts === 1 ? '' : 's'}, averaging ${Math.round(c.quiz_avg * 100)}%.`);
  if (b.stalled.length) facts.push(`Unfinished for a while: ${b.stalled.map((s) => `“${s.title}”`).join(', ')}.`);
  if (w.recent_checkins.length) facts.push(`Latest mood check-in: ${w.recent_checkins[0].mood}.`);
  if (w.recent_heavy_moments) facts.push(`${w.recent_heavy_moments} recent message${w.recent_heavy_moments === 1 ? '' : 's'} sounded stressful (only the label is kept, never your words).`);
  if (!facts.length) return <p className="muted small">Nothing yet — Vibe learns as you read, take quizzes and chat.</p>;
  return <ul className="known-list">{facts.map((f) => <li key={f}>{f}</li>)}</ul>;
}

export default function CompanionSettings() {
  const { notify, confirm } = useApp();
  const profile = useQuery(() => api.agent.profile(), []);
  const status = useQuery(() => api.agent.status(), []);
  const [busy, setBusy] = useState(false);
  const p = profile.data;
  const cfg = p?.settings || status.data?.settings;

  const save = async (patch) => {
    setBusy(true);
    try { await api.agent.settings(patch); profile.reload(); status.reload(); }
    catch (err) { notify(err.message, 'error'); }
    finally { setBusy(false); }
  };
  const forgetOne = async (id) => {
    try { await api.agent.forget(id); profile.reload(); } catch (err) { notify(err.message, 'error'); }
  };
  const forgetAll = async () => {
    if (!(await confirm({ title: 'Forget everything?', message: 'Vibe will delete every memory, quiz result, mood check-in and tone label it has stored about you. Your documents and notes are not touched.', confirmLabel: 'Forget everything', danger: true }))) return;
    try {
      const r = await api.agent.forgetAll();
      notify(`Forgot ${r.memories} memories and ${r.events} signals`);
      profile.reload();
    } catch (err) { notify(err.message, 'error'); }
  };

  if (!cfg) return <div className="setting-section"><Spinner size={16} /> Loading…</div>;
  const models = status.data?.models;

  return (
    <>
      <section className="setting-section">
        <div><h2>Personal companion</h2><p>Vibe adapts to how you read and how you’re doing. You decide how much it may learn.</p></div>
        <div className="setting-rows">
          <Switch checked={cfg.personalize} disabled={busy} onChange={(v) => save({ personalize: v })}
            label="Personalise to me" description="Use my reading habits, quiz results, mood check-ins and goals to tailor answers and suggestions. Turn off and Vibe uses and stores none of it." />
          <Row title="How Vibe talks" description="Tone of its replies.">
            <Segmented size="sm" value={cfg.tone} onChange={(tone) => save({ tone })} label="Tone"
              options={[{ value: 'warm', label: 'Warm' }, { value: 'balanced', label: 'Balanced' }, { value: 'concise', label: 'Concise' }]} />
          </Row>
          <Row title="Explanation level" description="Auto adapts to your quiz results.">
            <Segmented size="sm" value={cfg.explain_level} onChange={(explain_level) => save({ explain_level })} label="Explanation level"
              options={[{ value: 'auto', label: 'Auto' }, { value: 'simple', label: 'Simple' }, { value: 'standard', label: 'Standard' }, { value: 'expert', label: 'Expert' }]} />
          </Row>
        </div>
      </section>

      <section className="setting-section">
        <div><h2>What Vibe has noticed</h2><p>Worked out from your own activity. Estimates, not facts about you.</p></div>
        <div className="setting-rows">
          {profile.loading && !p ? <Spinner size={16} /> : p ? <Known profile={p} /> : null}
          {cfg.personalize === false && <p className="muted small"><ShieldCheck size={13} /> Personalisation is off, so nothing new is being collected.</p>}
        </div>
      </section>

      <section className="setting-section">
        <div><h2>What you’ve told Vibe</h2><p>Goals and preferences it remembers. Remove any of them whenever you like.</p></div>
        <div className="setting-rows">
          {p?.memories.length ? (
            <ul className="memory-list">
              {p.memories.map((m) => (
                <li key={m.id}>
                  <span className="memory-kind">{KIND_LABEL[m.kind] || 'Note'}</span>
                  <span className="memory-text">{m.text}</span>
                  <button className="icon-ghost sm" onClick={() => forgetOne(m.id)} aria-label={`Forget: ${m.text}`}><X size={13} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">Nothing saved. Tell Vibe things like “I’m preparing for my biology exam” or “keep answers short”.</p>}
          <button className="secondary-button danger-text" onClick={forgetAll}><Trash2 size={14} /> Forget everything Vibe has learned</button>
        </div>
      </section>

      <section className="setting-section">
        <div><h2>Under the hood</h2><p>Vibe stays on one model and only switches to a backup if that model keeps failing.</p></div>
        <div className="setting-rows">
          {models ? (
            <div className="status-grid">
              {models.length === 0 && <><span><Cpu size={14} /> Model</span><strong>offline engine</strong></>}
              {models.slice(0, 4).map((m) => (
                <React.Fragment key={`${m.provider}:${m.model}`}>
                  <span><Cpu size={14} /> {m.primary ? 'Primary' : 'Backup'}</span>
                  <strong>{m.model}{m.tools ? '' : ' (text only)'}{m.active ? ' · in use' : m.cooling_down_s ? ` · resting ${m.cooling_down_s}s` : ''}</strong>
                </React.Fragment>
              ))}
            </div>
          ) : <Spinner size={16} />}
          {status.data && !status.data.tools && <p className="muted small">Connected to a basic model, so Vibe answers from your document’s text without extra tools. Deploying with an AI key unlocks the full agent.</p>}
        </div>
      </section>
    </>
  );
}
