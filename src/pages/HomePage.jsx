// ─── Home dashboard ───────────────────────────────────────────────────────────
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Brain, CircleHelp, Clock3, Flame, Headphones, Highlighter, Map as MapIcon,
  Sparkles, Upload, WandSparkles, Workflow, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useAsync';
import { formatMinutes, greeting, timeAgo } from '../lib/format';
import { useIsMobile } from '../hooks/useMediaQuery';
import MobileHome from '../components/home/MobileHome';
import BriefingCard from '../components/agent/BriefingCard';
import { Cover, EmptyState, ErrorState, ProgressBar, SectionHead, Skeleton } from '../components/ui';

function ContinueCard({ doc }) {
  const navigate = useNavigate();
  const open = () => navigate(`/read/${doc.id}`);
  return (
    <article className="continue-card" onClick={open} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()} aria-label={`Continue reading ${doc.title}`}>
      <div className="card-kicker"><span className="pulse" aria-hidden="true" /> CONTINUE READING <span className="kicker-progress">{Math.round(doc.progress)}%</span></div>
      <div className="continue-content">
        <Cover doc={doc} size="lg" />
        <div className="continue-copy">
          <h2>{doc.title}</h2>
          <p>{doc.author}</p>
          {doc.current_chapter_title && <p className="continue-chapter">{doc.current_chapter_title}</p>}
          <div className="progress-row"><ProgressBar value={doc.progress} /><span>{doc.minutes_left} min left</span></div>
          <button className="resume-btn" onClick={(e) => { e.stopPropagation(); open(); }}>Resume reading <ArrowRight size={15} /></button>
        </div>
      </div>
      <div className="continue-footer">
        <span><Clock3 size={13} /> Opened {timeAgo(doc.last_opened_at)}</span>
        <span className="mode-pill">{doc.last_mode} mode</span>
      </div>
    </article>
  );
}

function StatsCard({ stats }) {
  const navigate = useNavigate();
  const max = Math.max(30, ...stats.week.map((d) => d.minutes));
  return (
    <section className="stats-card" aria-label="Reading statistics">
      <div className="section-top"><span className="eyebrow">YOUR READING RHYTHM</span></div>
      <div className="focus-number">{stats.week_minutes} <small>min</small></div>
      <p className="stats-sub">focus time this week · {stats.today_minutes} min today</p>
      <div className="bars" role="img" aria-label={`Minutes read per day this week: ${stats.week.map((d) => `${d.label} ${d.minutes}`).join(', ')}`}>
        {stats.week.map((d) => (
          <div key={d.date} className={`bar ${d.today ? 'today' : ''}`} style={{ height: `${Math.max(6, (d.minutes / max) * 100)}%` }} title={`${d.date}: ${d.minutes} min`}>
            <span>{d.label}</span>
          </div>
        ))}
      </div>
      <button className="streak-row" onClick={() => navigate('/read')}>
        <Flame size={15} />
        <span>{stats.streak ? `${stats.streak}-day reading streak` : 'Start a streak today'}</span>
        <ArrowRight size={13} />
      </button>
    </section>
  );
}

const REC_ICONS = { continue: BookOpen, summarize: Sparkles, mindmap: MapIcon, diagram: Workflow, quiz: CircleHelp };

export default function HomePage() {
  const { user, setUploadOpen, openAI, dataVersion } = useApp();
  const navigate = useNavigate();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion]);
  const stats = useQuery(() => api.activity.stats(), [dataVersion]);
  const recs = useQuery(() => api.ai.recommendations(), [dataVersion]);
  const books = useQuery(() => api.audio.list(), [dataVersion]);

  const isMobile = useIsMobile();
  const list = docs.data || [];
  const current = list.find((d) => d.status === 'ready' && d.last_opened_at && d.progress < 99) || list.find((d) => d.status === 'ready');
  const recent = list.filter((d) => d.id !== current?.id).slice(0, 3);
  const lastBook = (books.data || []).find((b) => b.status === 'ready' && b.progress > 0 && b.progress < 100);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const runRec = (r) => {
    if (r.action === 'continue') navigate(`/read/${r.document_id}`);
    else openAI({ documentId: r.document_id, tool: r.action === 'summarize' ? 'summarize' : r.action, nonce: Date.now() });
  };

  const actions = [
    { label: 'Upload document', detail: 'PDF, EPUB, DOCX, TXT, MD', icon: Upload, tone: 'coral', run: () => setUploadOpen(true) },
    { label: 'Read with AI', detail: 'Summaries, chat, mind maps', icon: Sparkles, tone: 'violet', run: () => openAI() },
    { label: 'Generate audiobook', detail: 'Humor, tough or regular voice', icon: Headphones, tone: 'blue', run: () => navigate('/audio?tab=generate') },
    { label: 'Start research', detail: 'From topic to cited draft', icon: Brain, tone: 'green', run: () => navigate('/research') },
  ];

  if (isMobile && list.length > 0) return <MobileHome docs={list} books={books.data} stats={stats.data} current={current} />;

  return (
    <div className="page-shell home-page">
      <header className="topbar">
        <div>
          <div className="eyebrow">{date}</div>
          <h1>{greeting()}, {user?.name?.split(' ')[0] || 'reader'}.</h1>
        </div>
        {stats.data && (
          <div className="mini-stats-row">
            {[
              { label: 'Completed', value: stats.data.books_completed, icon: BookOpen },
              { label: 'Audio hours', value: `${stats.data.audio_hours}h`, icon: Headphones },
              { label: 'Focus sessions', value: stats.data.focus_sessions, icon: Zap },
              { label: 'Highlights', value: stats.data.highlights, icon: Highlighter },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="mini-stat"><Icon size={16} /><div><strong>{value}</strong><small>{label}</small></div></div>
            ))}
          </div>
        )}
      </header>

      {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}

      {list.length > 0 && <BriefingCard />}

      {docs.loading && !docs.data ? (
        <section className="hero-grid"><Skeleton h={260} r={14} /><Skeleton h={260} r={14} /></section>
      ) : list.length === 0 && !docs.error ? (
        <EmptyState icon={BookOpen} title="Your next reading experience starts here."
          description="Upload a PDF, EPUB, DOCX or text file — ReadVibe splits it into chapters and unlocks AI tools, audio and immersive modes."
          action="Upload a document" onAction={() => setUploadOpen(true)} />
      ) : (
        <section className="hero-grid">
          {current ? <ContinueCard doc={current} /> : <Skeleton h={260} r={14} />}
          {stats.data ? <StatsCard stats={stats.data} /> : <Skeleton h={260} r={14} />}
        </section>
      )}

      <section className="section-block">
        <SectionHead eyebrow="MAKE IT YOURS" title="What would you like to do?" />
        <div className="action-grid">
          {actions.map(({ label, detail, icon: Icon, tone, run }) => (
            <button key={label} className="action-card" onClick={run}>
              <span className={`action-icon ${tone}`}><Icon size={19} /></span>
              <span className="action-text"><strong>{label}</strong><small>{detail}</small></span>
              <ArrowRight size={15} className="action-arrow" />
            </button>
          ))}
        </div>
      </section>

      {(recs.data?.length > 0 || lastBook) && (
        <section className="section-block">
          <SectionHead eyebrow="A NOTE FROM READVIBE" title="Suggested for you" />
          <div className="suggestions">
            {lastBook && (
              <button className="suggestion-row" onClick={() => navigate(`/audio?book=${lastBook.id}`)}>
                <span className="suggestion-icon"><Headphones size={16} /></span>
                <span>Resume listening to “{lastBook.title}” · {Math.round(lastBook.progress)}% done</span>
                <ArrowRight size={14} />
              </button>
            )}
            {(recs.data || []).slice(0, 4).map((r) => {
              const Icon = REC_ICONS[r.action] || WandSparkles;
              return (
                <button key={`${r.action}-${r.document_id}`} className="suggestion-row" onClick={() => runRec(r)}>
                  <span className="suggestion-icon"><Icon size={16} /></span>
                  <span>{r.label}</span>
                  <ArrowRight size={14} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section-block">
          <SectionHead eyebrow="FROM YOUR LIBRARY" title="Pick up where you left off" actionLabel="View library" onAction={() => navigate('/library')} />
          <div className="document-row">
            {recent.map((doc) => (
              <button key={doc.id} className="doc-card" onClick={() => navigate(`/read/${doc.id}`)} disabled={doc.status !== 'ready'}>
                <Cover doc={doc} />
                <span className="doc-info">
                  <span className="doc-type">{doc.type} · {doc.tags?.[0] || doc.format}</span>
                  <h3>{doc.title}</h3>
                  <p>{doc.author}</p>
                  <ProgressBar value={doc.progress} thin />
                  <small>{doc.status === 'processing' ? 'Processing…' : `${Math.round(doc.progress)}% · ${formatMinutes(doc.minutes_left)} left`}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
