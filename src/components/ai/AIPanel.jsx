// ─── AI reading companion (slide-over panel) ─────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BookmarkPlus, BookOpen, Brain, ChevronRight, CircleHelp, Copy, GitCompare, Image as ImageIcon,
  Lightbulb, MessageSquare, Search, Send, Sparkles, Trash2, Volume2, Workflow, X, Zap,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { speak } from '../../lib/speech';
import { Cover, ErrorState, RichText, Segmented, Spinner } from '../ui';
import Diagram from './Diagram';
import MindMap from './MindMap';
import { AILoading, CompareView, DefineView, ExplainView, QuizView, SummaryView, useAIRequest, VisualView } from './tools';

const TOOLS = [
  { id: 'summarize', label: 'Summarize', sub: 'Brief, standard or deep dive', icon: Sparkles },
  { id: 'explain', label: 'Explain', sub: 'Simple, student, expert, analogy', icon: Lightbulb },
  { id: 'mindmap', label: 'Mind map', sub: 'See the big picture', icon: Brain },
  { id: 'diagram', label: 'Diagram & flowchart', sub: 'Turn ideas into visuals', icon: Workflow },
  { id: 'quiz', label: 'Quiz me', sub: 'Questions + flashcards', icon: CircleHelp },
  { id: 'visual', label: 'Visual references', sub: 'Learn by seeing', icon: ImageIcon },
  { id: 'compare', label: 'Compare concepts', sub: 'Evidence side by side', icon: GitCompare },
  { id: 'define', label: 'Dictionary', sub: 'Definitions & pronunciation', icon: Search },
];

const chatMemory = new Map();

function MindMapView({ ctx, saveNote, openChapter }) {
  const [state, run] = useAIRequest();
  useEffect(() => { run(() => api.ai.mindmap(ctx.documentId, ctx.chapterIndex), ['Mapping chapters…', 'Connecting concepts…']); }, [ctx.documentId, ctx.chapterIndex]); // eslint-disable-line
  if (state.loading) return <AILoading stage={state.stage} />;
  if (state.error) return <ErrorState error={state.error} compact onRetry={() => run(() => api.ai.mindmap(ctx.documentId, ctx.chapterIndex))} />;
  if (!state.data) return null;
  const flatten = (n, depth = 0) => `${'  '.repeat(depth)}- ${n.label}${n.detail ? ` — ${n.detail}` : ''}\n${(n.children || []).map((c) => flatten(c, depth + 1)).join('')}`;
  return (
    <MindMap data={state.data} title={ctx.scopeTitle} onOpenChapter={openChapter}
      onSave={() => saveNote({ title: `Mind map · ${ctx.scopeTitle}`, content: flatten(state.data.root), category: 'AI Insight', note_type: 'mindmap', ai_payload: state.data })} />
  );
}

function DiagramView({ ctx, saveNote }) {
  const [kind, setKind] = useState('flowchart');
  const [layout, setLayout] = useState('TD');
  const [detail, setDetail] = useState('standard');
  const [state, run] = useAIRequest();
  const go = (k = kind, l = layout, d = detail) => run(() => api.ai.diagram({ document_id: ctx.documentId, chapter_index: ctx.chapterIndex, kind: k, layout: l, detail: d, text: ctx.selection || null }), ['Reading…', 'Creating visual…']);
  useEffect(() => { go(); }, [ctx.documentId, ctx.chapterIndex]); // eslint-disable-line
  return (
    <div className="ai-view">
      <div className="diagram-options">
        <Segmented size="sm" value={kind} onChange={(k) => { setKind(k); go(k); }} label="Diagram type"
          options={[{ value: 'flowchart', label: 'Flowchart' }, { value: 'concept', label: 'Concept' }, { value: 'block', label: 'Block' }]} />
        <div className="diagram-row">
          <Segmented size="sm" value={layout} onChange={(l) => { setLayout(l); go(kind, l); }} label="Layout"
            options={[{ value: 'TD', label: 'Vertical' }, { value: 'LR', label: 'Horizontal' }]} />
          <Segmented size="sm" value={detail} onChange={(d) => { setDetail(d); go(kind, layout, d); }} label="Detail"
            options={[{ value: 'simple', label: 'Simpler' }, { value: 'standard', label: 'Standard' }, { value: 'detailed', label: 'Detailed' }]} />
        </div>
      </div>
      {ctx.selection && <p className="muted small">Diagramming your selection: “{ctx.selection.slice(0, 80)}…”</p>}
      {state.loading && <AILoading stage={state.stage} />}
      {state.error && <ErrorState error={state.error} onRetry={() => go()} compact />}
      {state.data && !state.loading && (
        <Diagram data={state.data} title={ctx.scopeTitle}
          onSave={() => saveNote({ title: `${kind} · ${ctx.scopeTitle}`, content: state.data.mermaid, category: 'AI Insight', note_type: 'diagram', ai_payload: state.data })} />
      )}
    </div>
  );
}

function ChatView({ ctx, saveNote, openChapter, initialQuestion }) {
  const key = `${ctx.documentId}:${ctx.chapterIndex ?? 'all'}`;
  const [history, setHistory] = useState(() => chatMemory.get(key) || []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const sentInitial = useRef(false);

  useEffect(() => { setHistory(chatMemory.get(key) || []); }, [key]);
  useEffect(() => { chatMemory.set(key, history); }, [key, history]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [history, loading]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput('');
    const next = [...history, { role: 'user', content: q }];
    setHistory(next);
    setLoading(true);
    try {
      const res = await api.ai.chat({
        document_id: ctx.documentId, chapter_index: ctx.chapterIndex, question: q,
        history: history.slice(-8).map(({ role, content }) => ({ role, content })), selection: ctx.selection || null,
      });
      setHistory([...next, { role: 'assistant', content: res.answer, citations: res.citations, engine: res.engine, confidence: res.confidence }]);
    } catch (err) {
      setHistory([...next, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuestion && !sentInitial.current) { sentInitial.current = true; send(initialQuestion); }
  }, [initialQuestion]); // eslint-disable-line

  const suggestions = ctx.selection
    ? ['Explain the selected passage', 'Why does this matter?', 'Give me an example of this']
    : ['What are the key concepts?', 'Explain this chapter simply', 'What should I remember for an exam?', 'Quiz me with one question'];

  return (
    <div className="chat-view">
      <div className="chat-history" aria-live="polite">
        {history.length === 0 && (
          <div className="chat-bubble assistant intro">
            <Sparkles size={13} />
            <div>I’m grounded in <strong>{ctx.docTitle}</strong>{ctx.chapterIndex != null ? <> — focusing on <em>{ctx.scopeTitle}</em></> : null}. Ask about a concept, a passage or anything you highlighted. I’ll point you to where the answer is in the text.</div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'assistant' && <Sparkles size={13} />}
            <div className="chat-content">
              <RichText text={m.content} />
              {m.citations?.length > 0 && (
                <div className="citations">
                  {m.citations.map((c, j) => (
                    <button key={j} className="citation-tag" onClick={() => openChapter(c.chapter_index, c.snippet)} title={c.snippet}>
                      <BookOpen size={11} /> {c.chapter_title || `Chapter ${c.chapter_index + 1}`}
                    </button>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && !m.error && (
                <div className="bubble-actions">
                  <button onClick={() => navigator.clipboard?.writeText(m.content)} aria-label="Copy answer"><Copy size={12} /></button>
                  <button onClick={() => speak(m.content.replace(/\*/g, ''))} aria-label="Read aloud"><Volume2 size={12} /></button>
                  <button onClick={() => saveNote({ title: history[i - 1]?.content.slice(0, 120) || 'Chat answer', content: m.content, category: 'AI Insight', note_type: 'ai_insight' })} aria-label="Save to notes"><BookmarkPlus size={12} /></button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="chat-bubble assistant loading"><Sparkles size={13} /><div className="typing-dots"><span /><span /><span /></div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="suggested-prompts">
        {suggestions.map((p) => <button key={p} className="prompt-chip" onClick={() => send(p)} disabled={loading}>{p}</button>)}
        {history.length > 0 && <button className="prompt-chip ghost" onClick={() => setHistory([])}><Trash2 size={11} /> Clear</button>}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${ctx.scopeLabel}…`} aria-label="Ask a question"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="send-btn" disabled={!input.trim() || loading} aria-label="Send"><Send size={15} /></button>
      </form>
    </div>
  );
}

export default function AIPanel() {
  const { ai, closeAI, openAI, notify, dataVersion } = useApp();
  const navigate = useNavigate();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion], { enabled: ai.open });
  const status = useQuery(() => api.ai.status(), [], { enabled: ai.open });
  const [tool, setTool] = useState(null);
  const ready = (docs.data || []).filter((d) => d.status === 'ready');
  const documentId = ai.documentId || ready[0]?.id;
  const docDetail = useQuery(() => (documentId ? api.documents.get(documentId) : null), [documentId], { enabled: ai.open && !!documentId });

  useEffect(() => { if (ai.open) setTool(ai.tool || null); }, [ai.open, ai.tool, ai.nonce]);

  useEffect(() => {
    if (!ai.open) return undefined;
    const onKey = (e) => e.key === 'Escape' && (tool && ai.tab !== 'chat' ? setTool(null) : closeAI());
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ai.open, tool, ai.tab, closeAI]);

  const doc = docDetail.data;
  const chapterIndex = ai.chapterIndex ?? null;
  const ctx = useMemo(() => {
    const chapter = doc?.chapters?.[chapterIndex];
    return {
      documentId,
      chapterIndex,
      selection: ai.selection || '',
      docTitle: doc?.title || '',
      scopeTitle: chapter ? chapter.title : doc?.title || '',
      scopeLabel: chapter ? 'this chapter' : 'the whole document',
    };
  }, [doc, documentId, chapterIndex, ai.selection]);

  if (!ai.open) return null;

  const set = (patch) => openAI({ ...ai, ...patch });
  const saveNote = async (note) => {
    try {
      await api.notes.create({ document_id: documentId, chapter_index: chapterIndex, ...note });
      notify('Saved to your notebook', 'success', { action: { label: 'Open', onClick: () => { closeAI(); navigate('/notes'); } } });
    } catch (err) { notify(err.message, 'error'); }
  };
  const openChapter = (index, snippet) => {
    closeAI();
    navigate(`/read/${documentId}?chapter=${index}${snippet ? `&q=${encodeURIComponent(snippet.split(/\s+/).slice(0, 6).join(' ').replace(/[…"“”]/g, ''))}` : ''}`);
  };
  const askChat = (q) => set({ tab: 'chat', question: q, nonce: Date.now() });

  const activeTool = TOOLS.find((t) => t.id === tool);
  const views = {
    summarize: <SummaryView ctx={ctx} saveNote={saveNote} askChat={askChat} />,
    explain: <ExplainView ctx={ctx} saveNote={saveNote} />,
    mindmap: <MindMapView ctx={ctx} saveNote={saveNote} openChapter={openChapter} />,
    diagram: <DiagramView ctx={ctx} saveNote={saveNote} />,
    quiz: <QuizView ctx={ctx} saveNote={saveNote} />,
    visual: <VisualView ctx={ctx} saveNote={saveNote} defaultQuery={ctx.scopeTitle} />,
    compare: <CompareView ctx={ctx} saveNote={saveNote} />,
    define: <DefineView ctx={ctx} saveNote={saveNote} />,
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeAI()}>
      <aside className="ai-panel" role="dialog" aria-modal="true" aria-label="AI reading companion">
        <header className="panel-head">
          <div>
            <span className="eyebrow">READVIBE INTELLIGENCE</span>
            <h2><Sparkles size={19} /> Reading companion</h2>
          </div>
          <button className="icon-ghost" onClick={closeAI} aria-label="Close panel"><X size={19} /></button>
        </header>

        {docs.loading && !docs.data ? <div className="ai-context"><Spinner size={16} /> Loading documents…</div>
          : ready.length === 0 ? (
            <div className="ai-empty">
              <p>Add a document to your library to use AI tools.</p>
              <button className="primary-button" onClick={() => { closeAI(); navigate('/library'); }}>Go to library</button>
            </div>
          ) : (
            <div className="ai-context">
              <Cover doc={doc || ready.find((d) => d.id === documentId)} size="sm" />
              <div className="ai-context-fields">
                <select value={documentId || ''} onChange={(e) => set({ documentId: e.target.value, chapterIndex: null, selection: '' })} aria-label="Document">
                  {ready.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
                <select value={chapterIndex ?? ''} onChange={(e) => set({ chapterIndex: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Scope" disabled={!doc}>
                  <option value="">Whole document</option>
                  {(doc?.chapters || []).map((c) => <option key={c.index} value={c.index}>{c.index + 1}. {c.title}</option>)}
                </select>
              </div>
            </div>
          )}

        {ai.selection && (
          <div className="ai-selection">
            <span>“{ai.selection.length > 140 ? `${ai.selection.slice(0, 140)}…` : ai.selection}”</span>
            <button className="icon-ghost sm" onClick={() => set({ selection: '' })} aria-label="Clear selection"><X size={12} /></button>
          </div>
        )}

        <div className="ai-tabs" role="tablist">
          <button role="tab" aria-selected={ai.tab !== 'chat'} className={ai.tab !== 'chat' ? 'active' : ''} onClick={() => set({ tab: 'tools' })}><Zap size={13} /> AI tools</button>
          <button role="tab" aria-selected={ai.tab === 'chat'} className={ai.tab === 'chat' ? 'active' : ''} onClick={() => set({ tab: 'chat' })}><MessageSquare size={13} /> Chat with book</button>
        </div>

        <div className="panel-content">
          {!documentId || !doc ? (docDetail.loading ? <AILoading stage="Opening document…" /> : null)
            : ai.tab === 'chat' ? (
              <ChatView key={`${ctx.documentId}-${chapterIndex}-${ai.nonce || ''}`} ctx={ctx} saveNote={saveNote} openChapter={openChapter} initialQuestion={ai.question} />
            ) : activeTool ? (
              <>
                <button className="back-link" onClick={() => setTool(null)}><ArrowLeft size={14} /> All tools</button>
                <h3 className="result-title"><activeTool.icon size={16} /> {activeTool.label} <small>· {ctx.scopeTitle}</small></h3>
                {React.cloneElement(views[tool], { key: `${tool}-${documentId}-${chapterIndex}-${ai.selection}` })}
              </>
            ) : (
              <>
                <p className="panel-intro">What would you like to do with {ctx.scopeLabel}?</p>
                <div className="ai-tools">
                  {TOOLS.map(({ id, label, sub, icon: Icon }) => (
                    <button key={id} className="ai-tool-btn" onClick={() => setTool(id)}>
                      <span className="tool-icon"><Icon size={16} /></span>
                      <span className="tool-text"><strong>{label}</strong><small>{sub}</small></span>
                      <ChevronRight size={14} className="tool-arrow" />
                    </button>
                  ))}
                </div>
              </>
            )}
        </div>

        <footer className="panel-foot">
          <span><Zap size={12} /> {status.data?.llm ? `Powered by ${status.data.provider}` : 'Answers are grounded in your document’s text'}</span>
          <button onClick={closeAI} className="done-btn">Done</button>
        </footer>
      </aside>
    </div>
  );
}
