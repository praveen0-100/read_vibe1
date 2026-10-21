// ─── Research project workspace ──────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, CheckCircle2, Copy, ExternalLink, FileDown, FileText, Filter, History,
  Info, ListTree, Loader2, Minus, PenLine, Plus, Quote, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Unlock, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useDebounce, useQuery } from '../hooks/useAsync';
import { timeAgo } from '../lib/format';
import { EmptyState, ErrorState, Field, Modal, PageLoader, ProgressBar, Segmented, Spinner } from '../components/ui';

const STEPS = [
  { id: 'sources', label: 'Sources', icon: Search },
  { id: 'outline', label: 'Outline', icon: ListTree },
  { id: 'draft', label: 'Draft', icon: PenLine },
  { id: 'citations', label: 'Citations', icon: Quote },
  { id: 'review', label: 'Review', icon: ShieldCheck },
  { id: 'export', label: 'Export', icon: FileDown },
];
const SECTIONS = [
  ['abstract', 'Abstract'], ['introduction', 'Introduction'], ['literature_review', 'Literature Review'],
  ['methodology', 'Methodology'], ['results', 'Results & Discussion'], ['conclusion', 'Conclusion'],
];
const ACTIONS = [
  { id: 'expand', label: 'Expand', icon: Plus },
  { id: 'shorten', label: 'Shorten', icon: Minus },
  { id: 'academic', label: 'Academic tone', icon: BookOpen },
  { id: 'cite', label: 'Add citations', icon: Quote },
  { id: 'simplify', label: 'Simplify', icon: Sparkles },
];

// ─── Sources ──────────────────────────────────────────────────────────────────
function ManualReference({ onClose, onAdd }) {
  const [f, setF] = useState({ title: '', authors: '', year: '', venue: '', doi: '', url: '', abstract: '' });
  const submit = (e) => {
    e.preventDefault();
    onAdd({ ...f, authors: f.authors.split(/;|,(?=\s*[A-Z][a-z]+\s)/).map((a) => a.trim()).filter(Boolean), year: f.year ? Number(f.year) : null, provider: 'Manual', relevance: 0.6 });
  };
  return (
    <Modal open onClose={onClose} eyebrow="ADD REFERENCE" title="Add a source manually" icon={Plus}>
      <form className="stack" onSubmit={submit}>
        <Field label="Title"><input className="input" required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Authors" hint="Separate with semicolons: Jane Smith; Raj Patel"><input className="input" value={f.authors} onChange={(e) => setF({ ...f, authors: e.target.value })} /></Field>
        <div className="form-row">
          <Field label="Year"><input className="input" type="number" min="1500" max="2100" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></Field>
          <Field label="Journal / venue"><input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="DOI"><input className="input" value={f.doi} onChange={(e) => setF({ ...f, doi: e.target.value })} placeholder="10.1000/xyz" /></Field>
          <Field label="URL"><input className="input" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        </div>
        <Field label="Abstract" hint="Used to ground drafted text and check similarity"><textarea className="input" rows={4} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })} /></Field>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">Add reference</button></div>
      </form>
    </Modal>
  );
}

function ResultCard({ r, selected, onToggle, onAdd }) {
  return (
    <div className={`ref-card ${r.already_added ? 'added' : ''} ${selected ? 'selected' : ''}`}>
      <label className="ref-check">
        <input type="checkbox" checked={selected || r.already_added} disabled={r.already_added} onChange={onToggle} aria-label={`Select ${r.title}`} />
      </label>
      <div className="ref-body">
        <div className="ref-head">
          <strong>{r.title}</strong>
          <span className="relevance" title="Relevance score">{Math.round(r.relevance * 100)}%</span>
        </div>
        <small className="ref-meta">
          {(r.authors || []).slice(0, 3).join(', ')}{r.authors?.length > 3 ? ' et al.' : ''} · {r.year || 'n.d.'}{r.venue ? ` · ${r.venue}` : ''}
        </small>
        {r.summary && <p className="ref-summary">{r.summary}</p>}
        <div className="ref-tags">
          <span className="tag tag-default">{r.provider}</span>
          <span className="tag tag-default">{r.publication_type}</span>
          {r.citations > 0 && <span className="tag tag-blue">{r.citations.toLocaleString()} citations</span>}
          {r.open_access && <span className="tag tag-green"><Unlock size={10} /> Open access</span>}
          {r.url && <a className="tag tag-default" href={r.url} target="_blank" rel="noreferrer noopener">Open <ExternalLink size={10} /></a>}
        </div>
      </div>
      {r.already_added ? <span className="added-pill"><Check size={13} /> Added</span>
        : <button className="secondary-button small" onClick={onAdd}><Plus size={13} /> Add</button>}
    </div>
  );
}

function Sources({ project, onUpdate, autoDiscover }) {
  const { notify, confirm } = useApp();
  const [query, setQuery] = useState(project.topic);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({ minYear: '', openAccess: false, minCitations: 0, sort: 'relevance' });
  const [manual, setManual] = useState(false);

  const discover = async (q = query) => {
    setLoading(true); setError(null); setSelected(new Set());
    try { setRes(await api.research.discover(project.id, q, 20)); } catch (err) { setError(err); } finally { setLoading(false); }
  };
  useEffect(() => { if (autoDiscover) discover(project.topic); }, []); // eslint-disable-line

  const results = useMemo(() => {
    let list = [...(res?.results || [])];
    if (filters.minYear) list = list.filter((r) => (r.year || 0) >= Number(filters.minYear));
    if (filters.openAccess) list = list.filter((r) => r.open_access);
    if (filters.minCitations) list = list.filter((r) => (r.citations || 0) >= filters.minCitations);
    if (filters.sort === 'citations') list.sort((a, b) => (b.citations || 0) - (a.citations || 0));
    if (filters.sort === 'year') list.sort((a, b) => (b.year || 0) - (a.year || 0));
    return list;
  }, [res, filters]);

  const add = async (items) => {
    try {
      const out = await api.research.addReferences(project.id, items);
      onUpdate(out.project);
      notify(out.added.length ? `${out.added.length} source${out.added.length > 1 ? 's' : ''} added` : 'Already in your references', out.added.length ? 'success' : 'info');
      const titles = new Set(items.map((i) => i.title));
      setRes((r) => r && { ...r, results: r.results.map((x) => (titles.has(x.title) ? { ...x, already_added: true } : x)) });
      setSelected(new Set());
    } catch (err) { notify(err.message, 'error'); }
  };

  const toggleRef = async (ref) => {
    onUpdate({ ...project, references: project.references.map((r) => (r.id === ref.id ? { ...r, included: !r.included } : r)) });
    try { await api.research.updateReference(project.id, ref.id, { included: !ref.included }); } catch (err) { notify(err.message, 'error'); }
  };
  const removeRef = async (ref) => {
    if (!(await confirm({ title: 'Remove this reference?', message: ref.title, confirmLabel: 'Remove', danger: true }))) return;
    onUpdate({ ...project, references: project.references.filter((r) => r.id !== ref.id) });
    api.research.removeReference(project.id, ref.id).catch((err) => notify(err.message, 'error'));
  };

  return (
    <div className="sources-step">
      <form className="research-input compact" onSubmit={(e) => { e.preventDefault(); discover(); }}>
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search academic databases" />
        <button disabled={loading || !query.trim()}>{loading ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Discover</button>
      </form>

      <div className="filters-row">
        <Filter size={14} className="muted" />
        <label>From <input className="input xs" type="number" placeholder="year" value={filters.minYear} onChange={(e) => setFilters({ ...filters, minYear: e.target.value })} /></label>
        <label>Citations ≥ <select value={filters.minCitations} onChange={(e) => setFilters({ ...filters, minCitations: +e.target.value })}>{[0, 10, 50, 100, 500].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="check-line"><input type="checkbox" checked={filters.openAccess} onChange={(e) => setFilters({ ...filters, openAccess: e.target.checked })} /> Open access only</label>
        <Segmented size="sm" value={filters.sort} onChange={(v) => setFilters({ ...filters, sort: v })} label="Sort" options={[{ value: 'relevance', label: 'Relevance' }, { value: 'citations', label: 'Citations' }, { value: 'year', label: 'Newest' }]} />
      </div>

      {res?.warnings?.map((w) => <p key={w} className="warning-line"><Info size={13} /> {w}</p>)}
      {error && <ErrorState error={error} onRetry={() => discover()} compact />}
      {loading && <div className="ai-loading"><Spinner /> <span>Searching Semantic Scholar, Crossref and OpenAlex…</span></div>}

      {!loading && res && (
        <>
          <div className="results-head">
            <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
            {selected.size > 0 && <button className="primary-button small" onClick={() => add(results.filter((r) => selected.has(r.title)))}><Plus size={13} /> Add {selected.size} selected</button>}
          </div>
          <div className="ref-list">
            {results.map((r) => (
              <ResultCard key={r.title} r={r} selected={selected.has(r.title)} onAdd={() => add([r])}
                onToggle={() => setSelected((s) => { const n = new Set(s); n.has(r.title) ? n.delete(r.title) : n.add(r.title); return n; })} />
            ))}
          </div>
        </>
      )}

      <div className="section-heading">
        <div><div className="eyebrow">YOUR REFERENCES</div><h2>{project.references.filter((r) => r.included).length} included · {project.references.length} total</h2></div>
        <button className="secondary-button small" onClick={() => setManual(true)}><Plus size={13} /> Add manually</button>
      </div>
      {project.references.length === 0 ? <p className="muted">Add sources from the results above. Included sources ground your draft and appear in the bibliography.</p> : (
        <ul className="my-refs">
          {project.references.map((r) => (
            <li key={r.id} className={r.included ? '' : 'excluded'}>
              <button className={`include-toggle ${r.included ? 'on' : ''}`} onClick={() => toggleRef(r)} aria-pressed={r.included} title={r.included ? 'Included — click to exclude' : 'Excluded — click to include'}>
                {r.included ? <Check size={13} /> : <X size={13} />}
              </button>
              <div><strong>{r.title}</strong><small>{(r.authors || []).slice(0, 2).join(', ')}{r.authors?.length > 2 ? ' et al.' : ''} · {r.year || 'n.d.'} · {r.provider}</small></div>
              {r.url && <a className="icon-ghost sm" href={r.url} target="_blank" rel="noreferrer noopener" aria-label="Open source"><ExternalLink size={13} /></a>}
              <button className="icon-ghost sm" onClick={() => removeRef(r)} aria-label="Remove reference"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {manual && <ManualReference onClose={() => setManual(false)} onAdd={(ref) => { add([ref]); setManual(false); }} />}
    </div>
  );
}

// ─── Outline ──────────────────────────────────────────────────────────────────
function Outline({ project, onUpdate, goDraft }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try { const r = await api.research.outline(project.id); onUpdate({ ...project, outline: r.outline }); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };
  if (!project.outline?.length) {
    return <EmptyState icon={ListTree} title="Generate an outline" description="Builds a section-by-section plan from your topic and included sources." action={busy ? 'Generating…' : 'Generate outline'} onAction={generate} />;
  }
  return (
    <div className="outline">
      <div className="results-head"><span>Paper structure</span><button className="secondary-button small" onClick={generate} disabled={busy}><RefreshCw size={13} /> Regenerate</button></div>
      <ol>
        {project.outline.map((s) => (
          <li key={s.key}>
            <div className="outline-head"><strong>{s.title}</strong><button className="text-button" onClick={() => goDraft(s.key)}>Draft →</button></div>
            <ul>{s.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Draft editor ─────────────────────────────────────────────────────────────
function Draft({ project, onUpdate, initialSection }) {
  const { notify } = useApp();
  const [key, setKeyState] = useState(initialSection || 'abstract');
  const section = project.sections[key] || { content: '', versions: [] };
  const [text, setText] = useState(section.content);
  const [busy, setBusy] = useState(null);
  const [saveState, setSaveState] = useState('saved');
  const [showVersions, setShowVersions] = useState(false);
  const ref = useRef(null);
  const draftState = useMemo(() => ({ key, text }), [key, text]);
  const debounced = useDebounce(draftState, 900);
  const included = project.references.filter((r) => r.included);

  const persist = (k, content) => {
    setSaveState('saving');
    return api.research.editSection(project.id, k, content)
      .then((r) => { onUpdate({ ...project, sections: { ...project.sections, [k]: r.section }, progress: r.project.progress }); setSaveState('saved'); })
      .catch(() => setSaveState('error'));
  };

  const setKey = (k) => {
    if (text !== (project.sections[key]?.content || '')) persist(key, text); // flush unsaved edits first
    setKeyState(k);
    setText(project.sections[k]?.content || '');
    setSaveState('saved');
    setShowVersions(false);
  };

  useEffect(() => {
    // only autosave text that belongs to the section currently open
    if (debounced.key !== key || debounced.text === (project.sections[key]?.content || '')) return;
    persist(debounced.key, debounced.text);
  }, [debounced]); // eslint-disable-line

  const run = async (action) => {
    if (text !== (project.sections[key]?.content || '')) await api.research.editSection(project.id, key, text).catch(() => {});
    setBusy(action);
    try {
      const r = await api.research.draft(project.id, key, action);
      onUpdate({ ...project, sections: { ...project.sections, [key]: r.section }, progress: r.project.progress, status: r.project.status });
      setText(r.section.content);
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(null); }
  };
  const restore = async (i) => {
    try {
      const r = await api.research.restore(project.id, key, i);
      onUpdate({ ...project, sections: { ...project.sections, [key]: r.section } });
      setText(r.section.content);
      setShowVersions(false);
      notify('Version restored — the previous text was kept in history');
    } catch (err) { notify(err.message, 'error'); }
  };
  const insertCitation = (n) => {
    const el = ref.current;
    const pos = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, pos).replace(/\s*$/, '')} [${n}]${text.slice(pos)}`;
    setText(next);
    setTimeout(() => el?.focus(), 0);
  };
  const words = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="draft-editor">
      <div className="section-tabs" role="tablist">
        {SECTIONS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={k === key} className={k === key ? 'active' : ''} onClick={() => setKey(k)}>
            {(project.sections[k]?.content || '').trim() ? <CheckCircle2 size={12} className="ok" /> : <span className="dot-empty" />} {label}
          </button>
        ))}
      </div>
      <div className="editor-toolbar">
        <button className="primary-button small" onClick={() => run(text.trim() ? 'regenerate' : 'generate')} disabled={!!busy}>
          {busy === 'generate' || busy === 'regenerate' ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} {text.trim() ? 'Regenerate' : 'Generate'}
        </button>
        {ACTIONS.map((a) => (
          <button key={a.id} className="chip" onClick={() => run(a.id)} disabled={!!busy || !text.trim()}>
            {busy === a.id ? <Loader2 size={12} className="spin" /> : <a.icon size={12} />} {a.label}
          </button>
        ))}
        <span className="grow" />
        {section.versions?.length > 0 && <button className="chip" onClick={() => setShowVersions((s) => !s)}><History size={12} /> {section.versions.length} versions</button>}
      </div>
      {showVersions && (
        <div className="versions">
          {[...section.versions].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
            <div key={i} className="version">
              <div><strong>{v.action}</strong> <small>{timeAgo(v.created_at)} · {v.content.split(/\s+/).length} words</small></div>
              <p>{v.content.slice(0, 220)}{v.content.length > 220 ? '…' : ''}</p>
              <button className="text-button" onClick={() => restore(i)}>Restore</button>
            </div>
          ))}
        </div>
      )}
      <textarea ref={ref} className="input draft-text" value={text} onChange={(e) => { setText(e.target.value); setSaveState('dirty'); }}
        placeholder={`Write your ${SECTIONS.find(([k]) => k === key)[1].toLowerCase()} here, or press Generate to draft it from your sources.`} aria-label={`${key} text`} disabled={!!busy} />
      <div className="editor-foot">
        <span>{words} words</span>
        <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed — check connection' : 'All changes saved'}</span>
        {included.length > 0 && (
          <span className="cite-insert">Insert citation:
            {included.slice(0, 12).map((r, i) => <button key={r.id} className="chip xs" onClick={() => insertCitation(i + 1)} title={r.title}>[{i + 1}]</button>)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Citations ────────────────────────────────────────────────────────────────
function Citations({ project, onUpdate }) {
  const { notify } = useApp();
  const cit = useQuery(() => api.research.citations(project.id, project.citation_style), [project.citation_style, project.references.length, JSON.stringify(project.references.map((r) => r.included))]);
  const setStyle = async (s) => {
    onUpdate({ ...project, citation_style: s });
    api.research.update(project.id, { citation_style: s }).catch((e) => notify(e.message, 'error'));
  };
  const all = cit.data?.entries.map((e) => e.citation).join('\n') || '';
  return (
    <div className="citations-step">
      <div className="results-head">
        <Segmented value={project.citation_style} onChange={setStyle} label="Citation style" options={['APA', 'IEEE', 'MLA']} />
        <button className="secondary-button small" onClick={() => navigator.clipboard?.writeText(all).then(() => notify('Bibliography copied'))} disabled={!all}><Copy size={13} /> Copy all</button>
      </div>
      {cit.error && <ErrorState error={cit.error} onRetry={cit.reload} compact />}
      {cit.data?.warnings?.map((w, i) => (
        <p key={i} className={`warning-line ${w.level}`}>{w.level === 'info' ? <Info size={13} /> : <AlertTriangle size={13} />} {w.message}</p>
      ))}
      {cit.data?.entries.length === 0 && <p className="muted">Include at least one reference to build a bibliography.</p>}
      <ol className="bibliography">
        {(cit.data?.entries || []).map((e) => (
          <li key={e.reference_id}>
            <p>{e.citation}</p>
            <small>In text: <code>{e.in_text}</code></small>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Review ───────────────────────────────────────────────────────────────────
function Review({ project, goDraft }) {
  const rev = useQuery(() => api.research.review(project.id), [project.id]);
  if (rev.error) return <ErrorState error={rev.error} onRetry={rev.reload} />;
  if (!rev.data) return <div className="ai-loading"><Spinner /> <span>Checking similarity and citations…</span></div>;
  const flags = rev.data.sections.reduce((n, s) => n + s.similarity.length + s.needs_citation.length, 0);
  return (
    <div className="review-step">
      <div className="review-summary">
        <ShieldCheck size={22} />
        <div>
          <strong>{flags ? `${flags} passage${flags > 1 ? 's' : ''} worth checking` : 'No passages flagged'}</strong>
          <p>{rev.data.disclaimer}</p>
        </div>
        <button className="secondary-button small" onClick={rev.reload}><RefreshCw size={13} /> Re-run</button>
      </div>
      {rev.data.citation_warnings.map((w, i) => <p key={i} className={`warning-line ${w.level}`}><AlertTriangle size={13} /> {w.message}</p>)}
      {rev.data.sections.length === 0 && <p className="muted">Draft some sections first.</p>}
      {rev.data.sections.map((s) => (
        <section key={s.section} className="review-section">
          <div className="results-head"><strong>{s.title}</strong><span className="muted small">{s.words} words</span><button className="text-button" onClick={() => goDraft(s.section)}>Edit →</button></div>
          {!s.similarity.length && !s.needs_citation.length && <p className="ok-line"><Check size={13} /> Nothing flagged</p>}
          {s.similarity.map((f, i) => (
            <div key={i} className="flag sim">
              <span className="flag-type">{f.advice} · {Math.round(f.overlap * 100)}% overlap</span>
              <p>“{f.sentence}”</p>
              <small>Similar to: {f.source}</small>
            </div>
          ))}
          {s.needs_citation.map((c, i) => (
            <div key={i} className="flag cite">
              <span className="flag-type">Citation may be required</span>
              <p>“{c}”</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
function Export({ project, onUpdate }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(null);
  const filled = SECTIONS.filter(([k]) => project.sections[k]?.content?.trim()).length;
  const go = async (fmt) => {
    setBusy(fmt);
    try {
      await api.research.export(project.id, fmt);
      notify(`Exported as ${fmt.toUpperCase()}`);
      if (project.status !== 'complete' && filled === SECTIONS.length) {
        onUpdate({ ...project, status: 'review' });
        api.research.update(project.id, { status: 'review' }).catch(() => {});
      }
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(null); }
  };
  return (
    <div className="export-step">
      <p className="muted">{filled} of {SECTIONS.length} sections drafted · {project.references.filter((r) => r.included).length} references in {project.citation_style} style.</p>
      <div className="export-cards">
        {[
          ['docx', 'Word document', 'Editable, formatted with headings and a hanging-indent bibliography'],
          ['pdf', 'PDF', 'Print-ready, justified academic layout'],
          ['md', 'Markdown', 'Plain text for Git, Notion or Obsidian'],
        ].map(([fmt, label, desc]) => (
          <button key={fmt} className="export-card" onClick={() => go(fmt)} disabled={!!busy || filled === 0}>
            {busy === fmt ? <Loader2 size={22} className="spin" /> : <FileText size={22} />}
            <strong>{label}</strong><small>{desc}</small><span className="format-badge">.{fmt}</span>
          </button>
        ))}
      </div>
      {filled === 0 && <p className="warning-line"><AlertTriangle size={13} /> Draft at least one section before exporting.</p>}
    </div>
  );
}

export default function ResearchProjectPage() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useApp();
  const proj = useQuery(() => api.research.get(projectId), [projectId]);
  const step = params.get('step') || 'sources';
  const [draftSection, setDraftSection] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const p = proj.data;

  if (proj.error) return <div className="page-shell"><ErrorState error={proj.error} onRetry={proj.reload} /></div>;
  if (!p) return <PageLoader label="Opening project…" />;

  const setStep = (s) => setParams({ step: s });
  const goDraft = (k) => { setDraftSection(k); setStep('draft'); };
  const update = (np) => proj.setData((cur) => ({ ...cur, ...np }));
  const rename = async (title) => {
    setEditingTitle(false);
    if (!title.trim() || title === p.title) return;
    update({ title });
    api.research.update(p.id, { title }).catch((e) => notify(e.message, 'error'));
  };

  return (
    <div className="page-shell research-project">
      <button className="back-link" onClick={() => navigate('/research')}><ArrowLeft size={14} /> Research Studio</button>
      <header className="topbar">
        <div className="grow">
          <div className="eyebrow">RESEARCH PROJECT · {p.status.toUpperCase()}</div>
          {editingTitle
            ? <input className="input title-input" autoFocus defaultValue={p.title} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingTitle(false); }} aria-label="Project title" />
            : <h1 className="editable" onClick={() => setEditingTitle(true)} title="Click to rename">{p.title}</h1>}
          <p className="muted topic-line">{p.topic}</p>
        </div>
        <div className="project-progress"><ProgressBar value={p.progress} /><small>{p.progress}% drafted</small></div>
      </header>

      <div className="research-workspace">
        <nav className="step-nav" aria-label="Research steps">
          {STEPS.map(({ id, label, icon: Icon }, i) => (
            <button key={id} className={step === id ? 'active' : ''} onClick={() => setStep(id)} aria-current={step === id ? 'step' : undefined}>
              <span className="step-index">{i + 1}</span><Icon size={14} /> {label}
              {id === 'sources' && <small>{p.references.filter((r) => r.included).length}</small>}
            </button>
          ))}
        </nav>
        <section className="step-body">
          {step === 'sources' && <Sources project={p} onUpdate={update} autoDiscover={params.get('discover') === '1' && !p.references.length} />}
          {step === 'outline' && <Outline project={p} onUpdate={update} goDraft={goDraft} />}
          {step === 'draft' && <Draft project={p} onUpdate={update} initialSection={draftSection} />}
          {step === 'citations' && <Citations project={p} onUpdate={update} />}
          {step === 'review' && <Review project={p} goDraft={goDraft} />}
          {step === 'export' && <Export project={p} onUpdate={update} />}
        </section>
      </div>
    </div>
  );
}
