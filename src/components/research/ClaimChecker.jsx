// Claim checker: trace a statement to passages in the documents you choose, and show where sources disagree.
// Verdicts are lexical evidence (shared content words), never proof — the panel says so, and evidence is quoted source text.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';

const VERDICT = {
  supported: { label: 'Supported by the source', icon: CheckCircle2, cls: 'ok' },
  partial: { label: 'Partly supported', icon: CircleHelp, cls: 'warn' },
  unsupported: { label: 'Not found in the source', icon: AlertTriangle, cls: 'bad' },
};

export default function ClaimChecker({ documents = [] }) {
  const { notify } = useApp();
  const navigate = useNavigate();
  const ready = documents.filter((d) => d.status === 'ready');
  const [claim, setClaim] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const check = async () => {
    setBusy(true);
    try { setResult(await api.research_verify({ claim: claim.trim(), document_ids: [...picked] })); } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const open = (ev) => navigate(`/read/${ev.document_id}`);
  const v = result && VERDICT[result.verdict];

  return (
    <section className="research-card claim-checker">
      <div className="section-top"><span className="eyebrow">CLAIM CHECKER</span></div>
      <p className="fineprint" style={{ marginTop: 0 }}>Paste a statement and choose the documents to check it against. Evidence is quoted from your sources with its location.</p>
      <textarea className="input" rows={3} maxLength={1200} value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="e.g. Plants absorb about 90 percent of the water through their roots" />
      <div className="cc-docs" role="group" aria-label="Sources to check">
        {ready.length === 0 && <small className="muted">Upload a document to check claims against it.</small>}
        {ready.map((d) => (
          <label key={d.id} className={picked.has(d.id) ? 'on' : ''}>
            <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} /> {d.title}
          </label>
        ))}
      </div>
      <button className="primary-button" disabled={busy || claim.trim().length < 8 || picked.size === 0} onClick={check}>
        {busy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} Check claim
      </button>

      {result && v && (
        <div className="cc-result" aria-live="polite">
          <div className={`cc-verdict ${v.cls}`}><v.icon size={16} /> <strong>{v.label}</strong> <small>{Math.round(result.confidence * 100)}% of its key terms found</small></div>
          {result.sources_disagree && (
            <p className="cc-disagree"><AlertTriangle size={14} /> Your sources do not agree{result.possible_numeric_conflict ? ' — they give different figures' : ''}. Both are shown below instead of being merged.</p>
          )}
          {result.by_source.map((s) => (
            <div key={s.document_id} className="cc-source">
              <header><strong>{s.title}</strong><span className={`cc-tag ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].label}</span></header>
              {s.evidence.slice(0, 2).map((ev, i) => (
                <blockquote key={i}>
                  <p>{ev.text}</p>
                  <footer>
                    {ev.chapter_title} · paragraph {ev.paragraph_index + 1}{ev.page ? ` · page ${ev.page}` : ''}
                    <button className="text-button" onClick={() => open(ev)}>Open source</button>
                  </footer>
                </blockquote>
              ))}
            </div>
          ))}
          <p className="fineprint">{result.note} A match shows shared wording, not that a statement is true.</p>
        </div>
      )}
    </section>
  );
}
