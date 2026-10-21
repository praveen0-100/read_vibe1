// ─── Research Studio home ─────────────────────────────────────────────────────
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Brain, Check, FileText, Loader2, MoreHorizontal, Search, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { timeAgo } from '../lib/format';
import { EmptyState, ErrorState, Menu, ProgressBar, Skeleton } from '../components/ui';

const PIPELINE = ['Topic or sources', 'Discover papers', 'Include / exclude', 'Outline', 'Draft sections', 'Citation & similarity review', 'Export DOCX / PDF'];

export default function ResearchPage() {
  const navigate = useNavigate();
  const { notify, confirm } = useApp();
  const projects = useQuery(() => api.research.list(), []);
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), []);
  const [topic, setTopic] = useState('');
  const [sources, setSources] = useState([]);
  const [creating, setCreating] = useState(false);

  const create = async (e) => {
    e?.preventDefault();
    const t = topic.trim();
    if (t.length < 3) { notify('Describe your topic in a few words', 'warning'); return; }
    setCreating(true);
    try {
      const title = t.length > 70 ? `${t.slice(0, 67).trim()}…` : t.charAt(0).toUpperCase() + t.slice(1);
      const p = await api.research.create({ title, topic: t, source_document_ids: sources });
      navigate(`/research/${p.id}?step=sources&discover=1`);
    } catch (err) { notify(err.message, 'error'); } finally { setCreating(false); }
  };

  const remove = async (p) => {
    if (!(await confirm({ title: `Delete “${p.title}”?`, message: 'Its references and drafts will be permanently deleted.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.research.remove(p.id);
      projects.setData((l) => l.filter((x) => x.id !== p.id));
    } catch (err) { notify(err.message, 'error'); }
  };

  const papers = (docs.data || []).filter((d) => d.status === 'ready');

  return (
    <div className="page-shell research-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">RESEARCH STUDIO</div>
          <h1>From question to cited draft.</h1>
        </div>
      </header>

      <section className="research-hero">
        <div className="research-orb"><Brain size={28} /></div>
        <div>
          <h2>Start with a topic or your own sources</h2>
          <p>ReadVibe searches Semantic Scholar, Crossref and OpenAlex, ranks what it finds, and helps you draft each section — you stay in control of every source and sentence.</p>
        </div>
      </section>

      <form className="research-input" onSubmit={create}>
        <Search size={17} />
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Effects of ambient sound on reading comprehension" aria-label="Research topic" maxLength={2000} />
        <button disabled={creating || topic.trim().length < 3}>{creating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Start research</button>
      </form>

      {papers.length > 0 && (
        <div className="source-picker">
          <div className="eyebrow">OPTIONAL · USE DOCUMENTS FROM YOUR LIBRARY AS SOURCES</div>
          <div className="source-chips">
            {papers.slice(0, 12).map((d) => {
              const on = sources.includes(d.id);
              return (
                <button key={d.id} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => setSources((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))}>
                  {on ? <Check size={12} /> : <FileText size={12} />} {d.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="research-columns">
        <section className="research-card">
          <div className="section-top"><span className="eyebrow">YOUR PROJECTS</span></div>
          {projects.error && <ErrorState error={projects.error} onRetry={projects.reload} compact />}
          {projects.loading && !projects.data && <Skeleton h={120} />}
          {projects.data?.length === 0 && <EmptyState icon={Brain} title="Start with a topic or upload your sources." description="Your research projects will appear here." />}
          {(projects.data || []).map((p) => (
            <div key={p.id} className="project-item">
              <button className="project-main" onClick={() => navigate(`/research/${p.id}`)}>
                <span className={`project-icon ${p.status === 'complete' ? 'green' : 'purple'}`}><Brain size={15} /></span>
                <span className="project-body">
                  <strong>{p.title}</strong>
                  <small>{p.included_count} sources · {p.status} · updated {timeAgo(p.updated_at)}</small>
                  <ProgressBar value={p.progress} thin />
                </span>
                <ArrowRight size={14} className="muted" />
              </button>
              <Menu trigger={<MoreHorizontal size={15} />} items={[{ label: 'Delete project', icon: Trash2, danger: true, onClick: () => remove(p) }]} />
            </div>
          ))}
        </section>

        <section className="research-card discover-card">
          <div className="section-top"><span className="eyebrow">HOW IT WORKS</span></div>
          <ol className="pipeline">
            {PIPELINE.map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}
          </ol>
          <p className="fineprint">The similarity review flags passages to check and cite. It never claims a text is plagiarism-free — always review sources yourself.</p>
        </section>
      </div>
    </div>
  );
}
