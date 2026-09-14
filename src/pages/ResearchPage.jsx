// ─── Research Studio Page ─────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  Brain, Search, FileText, ArrowRight, Plus, Check, X, ChevronDown,
  ExternalLink, BookOpen, Download, Sparkles, RotateCcw, ChevronRight, ChevronLeft,
  AlertTriangle, Users
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProgressBar, EmptyState, SectionHead, Spinner } from '../components/ui';
import { MOCK_REFERENCES, RESEARCH_PROJECTS } from '../data/mockData';

// ─── Reference Card ───────────────────────────────────────────────────────────
function ReferenceCard({ ref: paper, onToggle }) {
  return (
    <div className={`ref-card ${paper.included ? 'included' : ''}`}>
      <div className="ref-head">
        <div className="ref-meta">
          <span className="ref-provider">{paper.provider}</span>
          {paper.openAccess && <span className="ref-oa">Open Access</span>}
          <span className="ref-year">{paper.year}</span>
        </div>
        <div className="relevance-score">
          <div className="relevance-bar">
            <div style={{ width: `${paper.relevance * 100}%` }} />
          </div>
          <span>{Math.round(paper.relevance * 100)}% match</span>
        </div>
      </div>
      <h4 className="ref-title">{paper.title}</h4>
      <p className="ref-authors">{paper.authors.join(', ')}</p>
      <div className="ref-stats">
        <span>{paper.citations} citations</span>
      </div>
      <div className="ref-actions">
        <button className="ref-link" onClick={() => {}}>
          <ExternalLink size={13} /> View paper
        </button>
        <button
          className={`include-btn ${paper.included ? 'included' : ''}`}
          onClick={() => onToggle(paper.id)}
        >
          {paper.included ? <><Check size={13} /> Included</> : <><Plus size={13} /> Include</>}
        </button>
      </div>
    </div>
  );
}

// ─── Research Discovery ───────────────────────────────────────────────────────
function DiscoveryView({ topic, onBack }) {
  const [refs, setRefs] = useState(MOCK_REFERENCES);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(true);
  const [sortBy, setSortBy] = useState('relevance');
  const [filterOA, setFilterOA] = useState(false);

  const toggleRef = (id) => {
    setRefs(prev => prev.map(r => r.id === id ? { ...r, included: !r.included } : r));
  };

  const sorted = [...refs]
    .filter(r => filterOA ? r.openAccess : true)
    .sort((a, b) => sortBy === 'relevance' ? b.relevance - a.relevance : b.citations - a.citations);

  const included = refs.filter(r => r.included).length;

  return (
    <div className="discovery-view">
      <div className="discovery-header">
        <button className="back-link" onClick={onBack}><ChevronLeft size={16} /> Back</button>
        <h3>Reference Discovery</h3>
        <p className="topic-label">Topic: <em>{topic}</em></p>
      </div>

      <div className="discovery-toolbar">
        <div className="discovery-filters">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="relevance">Sort by Relevance</option>
            <option value="citations">Sort by Citations</option>
          </select>
          <label className="oa-filter">
            <input type="checkbox" checked={filterOA} onChange={e => setFilterOA(e.target.checked)} />
            Open Access only
          </label>
        </div>
        <div className="included-count">
          <Check size={14} /> {included} source{included !== 1 ? 's' : ''} selected
        </div>
      </div>

      <div className="refs-grid">
        {sorted.map(ref => (
          <ReferenceCard key={ref.id} ref={ref} onToggle={toggleRef} />
        ))}
      </div>

      <div className="discovery-footer">
        <button className="primary-button" onClick={onBack}>
          Build research context with {included} source{included !== 1 ? 's' : ''} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Paper Drafting ───────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'abstract', label: 'Abstract', prompt: 'Write a concise abstract summarizing the key findings and scope of this research.' },
  { id: 'introduction', label: 'Introduction', prompt: 'Write an introduction that establishes context, motivation, and research objectives.' },
  { id: 'literatureReview', label: 'Literature Review', prompt: 'Synthesize the selected sources into a coherent literature review.' },
  { id: 'methodology', label: 'Methodology', prompt: 'Describe the research methodology and approach used.' },
  { id: 'results', label: 'Results & Discussion', prompt: 'Present and interpret the key findings.' },
  { id: 'conclusion', label: 'Conclusion', prompt: 'Summarize findings, implications, and future work.' },
  { id: 'references', label: 'References', prompt: 'Format all included sources in selected citation style.' },
];

function DraftSection({ section, content, onGenerate }) {
  const [expanded, setExpanded] = useState(section.id === 'abstract');
  const [localContent, setLocalContent] = useState(content);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    const generated = `[AI-generated ${section.label}]\n\nThis section has been drafted based on your selected sources and research topic. In the full implementation, this content would be generated by the connected AI model using RAG over your uploaded documents and discovered references.\n\nThe content here demonstrates the structure and length appropriate for this section of your research paper.`;
    setLocalContent(generated);
    onGenerate(section.id, generated);
    setLoading(false);
    setExpanded(true);
  };

  return (
    <div className={`draft-section ${expanded ? 'open' : ''}`}>
      <button className="draft-section-head" onClick={() => setExpanded(!expanded)}>
        <div>
          <strong>{section.label}</strong>
          <span className={`section-status ${localContent ? 'draft' : 'empty'}`}>
            {localContent ? 'Draft' : 'Empty'}
          </span>
        </div>
        <ChevronDown size={16} className={`chevron ${expanded ? 'open' : ''}`} />
      </button>
      {expanded && (
        <div className="draft-body">
          <textarea
            value={localContent}
            onChange={e => setLocalContent(e.target.value)}
            placeholder={`${section.prompt}\n\nStart writing or generate with AI...`}
            rows={8}
            className="draft-textarea"
          />
          <div className="draft-controls">
            <button className="secondary-button" onClick={generate} disabled={loading}>
              {loading ? <Spinner size={13} /> : <Sparkles size={13} />}
              {loading ? 'Generating...' : 'Generate with AI'}
            </button>
            <button className="secondary-button" onClick={() => {}}>
              <RotateCcw size={13} /> Regenerate
            </button>
            <button className="secondary-button" onClick={() => {}}>
              Expand
            </button>
            <button className="secondary-button" onClick={() => {}}>
              Improve tone
            </button>
            <button className="secondary-button" onClick={() => {}}>
              Add citations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftingView({ project, onBack, notify }) {
  const [sectionContent, setSectionContent] = useState(
    SECTIONS.reduce((acc, s) => ({ ...acc, [s.id]: project?.sections?.[s.id]?.content || '' }), {})
  );
  const [citationStyle, setCitationStyle] = useState('APA');

  const handleGenerate = (sectionId, content) => {
    setSectionContent(prev => ({ ...prev, [sectionId]: content }));
  };

  const draftedCount = Object.values(sectionContent).filter(Boolean).length;

  return (
    <div className="drafting-view">
      <div className="draft-header">
        <button className="back-link" onClick={onBack}><ChevronLeft size={16} /> Back</button>
        <div>
          <h3>{project?.title || 'New Research Paper'}</h3>
          <p>{project?.sources} sources · {draftedCount}/{SECTIONS.length} sections drafted</p>
        </div>
        <div className="draft-header-right">
          <select value={citationStyle} onChange={e => setCitationStyle(e.target.value)} className="citation-select">
            <option value="APA">APA</option>
            <option value="IEEE">IEEE</option>
          </select>
          <button className="secondary-button" onClick={() => notify(`Exported as DOCX (${citationStyle})`)}>
            <Download size={14} /> Export DOCX
          </button>
          <button className="primary-button" onClick={() => notify('Saved')}>
            <Check size={14} /> Save
          </button>
        </div>
      </div>

      <div className="plagiarism-notice">
        <AlertTriangle size={14} />
        <span>AI content may require paraphrasing. Always review for source attribution before submission.</span>
      </div>

      <div className="draft-sections">
        {SECTIONS.map(s => (
          <DraftSection
            key={s.id}
            section={s}
            content={sectionContent[s.id]}
            onGenerate={handleGenerate}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Research Home ────────────────────────────────────────────────────────────
export default function ResearchPage() {
  const { state, dispatch, notify } = useApp();
  const { researchProjects } = state;
  const [step, setStep] = useState('home'); // 'home' | 'discover' | 'draft'
  const [topic, setTopic] = useState('');
  const [activeProject, setActiveProject] = useState(null);

  if (step === 'discover') return <DiscoveryView topic={topic} onBack={() => setStep('draft')} />;
  if (step === 'draft') return <DraftingView project={activeProject} onBack={() => setStep('home')} notify={notify} />;

  return (
    <div className="page-shell research-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">RESEARCH STUDIO</div>
          <h1>Turn curiosity into clarity.</h1>
        </div>
        <div className="top-actions">
          <button className="primary-button" onClick={() => setStep('draft')}>
            <Plus size={15} /> New project
          </button>
        </div>
      </header>

      {/* Hero input */}
      <div className="research-hero">
        <div className="research-orb"><Brain size={38} /></div>
        <div>
          <div className="eyebrow">YOUR RESEARCH COPILOT</div>
          <h2>What are you exploring?</h2>
          <p>Start with a question, a topic, or upload your source material. ReadVibe will help you discover, understand, and draft.</p>
        </div>
      </div>

      <div className="research-input">
        <Search size={18} />
        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="e.g. How does ambient sound affect reading comprehension?"
          onKeyDown={e => e.key === 'Enter' && topic && setStep('discover')}
          aria-label="Research topic"
        />
        <button
          className="explore-btn"
          onClick={() => topic ? setStep('discover') : notify('Enter a research topic to begin')}
        >
          Explore <ArrowRight size={15} />
        </button>
      </div>

      <div className="research-columns">
        {/* Active Projects */}
        <div className="research-card">
          <div className="section-top">
            <span className="eyebrow">ACTIVE PROJECTS</span>
            <MoreHorizontal size={17} />
          </div>
          {researchProjects.length === 0 ? (
            <EmptyState emoji="🔬" title="No research projects yet." description="Start with a topic or upload your sources." />
          ) : (
            researchProjects.map(proj => (
              <div key={proj.id} className="project-item" onClick={() => { setActiveProject(proj); setStep('draft'); }} role="button" tabIndex={0}>
                <div className={`project-icon ${proj.status === 'drafting' ? 'purple' : 'green'}`}>
                  <FileText size={16} />
                </div>
                <div className="project-body">
                  <strong>{proj.title}</strong>
                  <small>{proj.sources} sources · Updated {proj.lastUpdated}</small>
                  <ProgressBar value={proj.progress} thin />
                </div>
                <ArrowRight size={15} />
              </div>
            ))
          )}
        </div>

        {/* Research Tools */}
        <div className="research-card discover-card">
          <div className="section-top">
            <span className="eyebrow">RESEARCH TOOLS</span>
          </div>
          {[
            { label: 'Discover references', detail: 'Search Semantic Scholar & Crossref', icon: Search, action: () => topic ? setStep('discover') : notify('Enter a topic first') },
            { label: 'Draft a paper', detail: 'Work section by section with AI', icon: FileText, action: () => setStep('draft') },
            { label: 'Review citations', detail: 'APA and IEEE ready', icon: Check, action: () => notify('Citation review opened') },
            { label: 'Collaborative research', detail: 'Invite co-authors', icon: Users, action: () => notify('Collaboration — coming soon') },
          ].map(({ label, detail, icon: Icon, action }) => (
            <button key={label} className="research-tool-btn" onClick={action}>
              <Icon size={17} />
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

