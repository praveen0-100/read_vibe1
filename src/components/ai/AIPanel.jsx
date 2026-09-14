// ─── AI Panel (Slide-over) ────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  X, Sparkles, Lightbulb, Brain, WandSparkles, CircleHelp, Search,
  ArrowRight, Send, Zap, ChevronDown, ChevronRight, RotateCcw,
  BookOpen, Download, Share2, Check
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Spinner, ProgressBar } from '../ui';
import { MOCK_RESPONSES } from '../../api/client';

const AI_TOOLS = [
  { id: 'summarize', label: 'Summarize this chapter', sub: '3 levels of depth', icon: Sparkles },
  { id: 'explain', label: 'Explain selected text', sub: 'Simple, student or expert', icon: Lightbulb },
  { id: 'mindmap', label: 'Create a mind map', sub: 'See the big picture', icon: Brain },
  { id: 'diagram', label: 'Generate a diagram', sub: 'Make it visual with Mermaid', icon: WandSparkles },
  { id: 'quiz', label: 'Quiz me', sub: 'Test your memory', icon: CircleHelp },
  { id: 'visual', label: 'Find visual references', sub: 'Learn by seeing', icon: Search },
];

const SUMMARY_DEPTHS = [
  { id: 'brief', label: 'Brief', sub: 'The essential idea in 3 sentences' },
  { id: 'standard', label: 'Standard', sub: 'Main concepts with context' },
  { id: 'deep', label: 'Deep Dive', sub: 'Full detail for study or research' },
];

const EXPLAIN_MODES = ['Simple', 'Student', 'Expert'];

function SummaryView({ doc, onClose, notify }) {
  const [depth, setDepth] = useState('standard');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');

  const generate = async () => {
    setLoading(true);
    setResult(null);
    const stages = ['Reading document...', 'Understanding content...', 'Generating summary...'];
    for (const s of stages) {
      setStage(s);
      await new Promise(r => setTimeout(r, 600));
    }
    setResult(MOCK_RESPONSES.summarize(depth));
    setLoading(false);
  };

  return (
    <div className="ai-result-view">
      <h3 className="result-title"><Sparkles size={16} /> Summarize</h3>
      <div className="depth-selector">
        {SUMMARY_DEPTHS.map(d => (
          <button
            key={d.id}
            className={`depth-btn ${depth === d.id ? 'active' : ''}`}
            onClick={() => setDepth(d.id)}
          >
            <strong>{d.label}</strong>
            <small>{d.sub}</small>
          </button>
        ))}
      </div>
      <button className="primary-button full-width" onClick={generate} disabled={loading}>
        {loading ? <><Spinner size={14} /> {stage}</> : 'Generate summary'}
      </button>

      {result && (
        <div className="summary-output">
          <div className="summary-section">
            <div className="summary-label">MAIN IDEA</div>
            <p>{result.summary.mainIdea}</p>
          </div>
          <div className="summary-section">
            <div className="summary-label">KEY POINTS</div>
            <ul className="key-points">
              {result.summary.keyPoints.map((pt, i) => (
                <li key={i}><Check size={13} />{pt}</li>
              ))}
            </ul>
          </div>
          <div className="summary-section">
            <div className="summary-label">KEY CONCEPTS</div>
            <div className="concept-pills">
              {result.summary.concepts.map(c => (
                <span key={c} className="concept-pill">{c}</span>
              ))}
            </div>
          </div>
          <div className="summary-section">
            <div className="summary-label">TAKEAWAY</div>
            <p className="takeaway">{result.summary.takeaways}</p>
          </div>
          <div className="summary-section">
            <div className="summary-label">EXPLORE FURTHER</div>
            {result.summary.suggestedQuestions.map((q, i) => (
              <button key={i} className="suggested-q">→ {q}</button>
            ))}
          </div>
          <div className="result-actions">
            <button className="secondary-button" onClick={() => notify('Summary saved to notebook')}><Download size={13} /> Save to notes</button>
            <button className="secondary-button" onClick={() => notify('Summary copied')}><Share2 size={13} /> Share</button>
            <button className="secondary-button" onClick={generate}><RotateCcw size={13} /> Regenerate</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuizView({ doc, notify }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState(false);

  const generate = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setQuiz(MOCK_RESPONSES.quiz());
    setLoading(false);
    setLoaded(true);
  };

  const score = quiz ? quiz.questions.filter((q, i) => q.correct !== undefined && answers[q.id] === q.correct).length : 0;

  return (
    <div className="ai-result-view">
      <h3 className="result-title"><CircleHelp size={16} /> Quiz Me</h3>
      {!loaded && (
        <button className="primary-button full-width" onClick={generate} disabled={loading}>
          {loading ? <><Spinner size={14} /> Generating questions...</> : 'Generate quiz from this chapter'}
        </button>
      )}
      {quiz && (
        <div className="quiz-view">
          <div className="quiz-meta">Chapter 6 · {quiz.questions.length} questions</div>
          {quiz.questions.map((q, qi) => (
            <div key={q.id} className="quiz-question">
              <div className="q-number">Q{qi + 1}</div>
              <p className="q-text">{q.question}</p>
              {q.options && (
                <div className="q-options">
                  {q.options.map((opt, oi) => (
                    <button
                      key={oi}
                      className={`q-option ${answers[q.id] === oi ? 'selected' : ''} ${revealed && oi === q.correct ? 'correct' : ''} ${revealed && answers[q.id] === oi && oi !== q.correct ? 'wrong' : ''}`}
                      onClick={() => setAnswers(prev => ({ ...prev, [q.id]: oi }))}
                    >
                      <span className="opt-letter">{String.fromCharCode(65 + oi)}</span>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'short_answer' && (
                <textarea className="q-textarea" placeholder={q.hint} rows={3} />
              )}
            </div>
          ))}
          {!revealed && Object.keys(answers).length > 0 && (
            <button className="primary-button full-width" onClick={() => setRevealed(true)}>
              Check answers ({Object.keys(answers).length}/{quiz.questions.filter(q => q.options).length})
            </button>
          )}
          {revealed && (
            <div className="quiz-score">
              <strong>{score}/{quiz.questions.filter(q => q.options).length}</strong>
              <span>correct answers</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatView({ doc }) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([
    { role: 'assistant', content: `I'm grounded in **${doc.title}**. Ask me about the chapter, a concept, or something you highlighted.` }
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const send = async (text) => {
    const q = text || input;
    if (!q.trim()) return;
    const userMsg = { role: 'user', content: q };
    setHistory(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 1100));
    const res = MOCK_RESPONSES.chat(q);
    setHistory(prev => [...prev, { role: 'assistant', content: res.answer, citations: res.citations }]);
    setLoading(false);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const SUGGESTED = [
    'What is the main idea of this chapter?',
    'Give me a real-world example of affordances',
    'What should I remember for an exam?',
    'Compare this with the previous chapter',
  ];

  return (
    <div className="chat-view">
      <div className="chat-history">
        {history.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            {msg.role === 'assistant' && <Sparkles size={13} />}
            <div dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            {msg.citations?.map(c => (
              <div key={c.page} className="citation-tag">p. {c.page} · {c.label}</div>
            ))}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant loading">
            <Sparkles size={13} />
            <div className="typing-dots"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="suggested-prompts">
        {SUGGESTED.slice(0, 2).map(p => (
          <button key={p} className="prompt-chip" onClick={() => send(p)}>{p}</button>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about this book..."
          aria-label="Chat input"
        />
        <button
          className="send-btn"
          onClick={() => send()}
          disabled={!input.trim() || loading}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

export default function AIPanel() {
  const { state, dispatch, notify } = useApp();
  const { aiOpen, aiTab, activeDoc } = state;
  const [activeTool, setActiveTool] = useState(null);

  if (!aiOpen) return null;
  const close = () => {
    dispatch({ type: 'SET_AI_OPEN', payload: false });
    setActiveTool(null);
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && close()}>
      <div className="ai-panel" role="dialog" aria-label="AI Tools" aria-modal="true">
        {/* Header */}
        <div className="panel-head">
          <div>
            <span className="eyebrow">READVIBE INTELLIGENCE</span>
            <h2><Sparkles size={20} /> Your reading companion</h2>
          </div>
          <button onClick={close} aria-label="Close panel"><X size={19} /></button>
        </div>

        {/* Document context */}
        <div className="ai-context">
          <div className={`mini-cover-sm cover-${activeDoc.color}`}>{activeDoc.coverSymbol}</div>
          <div>
            <strong>{activeDoc.title}</strong>
            <small>Context: {activeDoc.chapter}</small>
          </div>
          <button className="context-change" onClick={() => notify('Switch document context')}>
            <ChevronDown size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="ai-tabs" role="tablist">
          {['tools', 'chat'].map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={aiTab === tab}
              className={aiTab === tab ? 'active' : ''}
              onClick={() => { dispatch({ type: 'SET_AI_TAB', payload: tab }); setActiveTool(null); }}
            >
              {tab === 'tools' ? 'AI tools' : 'Chat with book'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="panel-content">
          {aiTab === 'tools' ? (
            activeTool === 'summarize' ? (
              <SummaryView doc={activeDoc} onClose={() => setActiveTool(null)} notify={notify} />
            ) : activeTool === 'quiz' ? (
              <QuizView doc={activeDoc} notify={notify} />
            ) : (
              <>
                <p className="panel-intro">What would you like to do with this chapter?</p>
                <div className="ai-tools">
                  {AI_TOOLS.map(({ id, label, sub, icon: Icon }) => (
                    <button
                      key={id}
                      className="ai-tool-btn"
                      onClick={() => {
                        if (id === 'summarize' || id === 'quiz') setActiveTool(id);
                        else notify(`${label} — coming in next sprint`);
                      }}
                    >
                      <span className="tool-icon"><Icon size={17} /></span>
                      <div>
                        <strong>{label}</strong>
                        <small>{sub}</small>
                      </div>
                      <ChevronRight size={14} className="tool-arrow" />
                    </button>
                  ))}
                </div>
              </>
            )
          ) : (
            <ChatView doc={activeDoc} />
          )}
        </div>

        {/* Footer */}
        <div className="panel-foot">
          <span><Zap size={12} /> AI responses use document context</span>
          <button onClick={close} className="done-btn">Done</button>
        </div>
      </div>
    </div>
  );
}
