// ─── Home dashboard ───────────────────────────────────────────────────────────
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Brain, CircleHelp, Clock3, Flame, Headphones, Highlighter, Map as MapIcon,
  Sparkles, Upload, WandSparkles, Workflow, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import GoalsCard from '../components/home/GoalsCard';
import { useQuery } from '../hooks/useAsync';
import { greeting, timeAgo } from '../lib/format';
import { useIsMobile } from '../hooks/useMediaQuery';
import MobileHome from '../components/home/MobileHome';
import BriefingCard from '../components/agent/BriefingCard';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '../components/ui';
import HomeShelves from '../components/home/HomeShelves';
import { BookCover, posterHue } from '../components/home/HomeTiles';
import { useCoverUrl } from '../lib/covers';

/** Large "continue" panel: the book's own cover, blurred and grained into the backdrop, with the next action beside it. */
function DeskHero({ doc, audio }) {
  const navigate = useNavigate();
  const url = useCoverUrl(doc.has_cover ? doc.id : null);
  const open = () => navigate(`/read/${doc.id}`);
  return (
    <article className="dh-continue" style={doc.has_cover ? undefined : { '--c1': `hsl(${posterHue(doc.title)} 52% 40%)`, '--c2': `hsl(${(posterHue(doc.title) + 38) % 360} 58% 18%)` }} onClick={open} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()} aria-label={`Continue reading ${doc.title}`}>
      {url && <span className="dh-backdrop" style={{ backgroundImage: `url(${url})` }} aria-hidden="true" />}
      <span className="dh-grain" aria-hidden="true" />
      <span className="dh-cover"><BookCover doc={doc} /></span>
      <div className="dh-copy">
        <div className="card-kicker"><span className="pulse" aria-hidden="true" /> CONTINUE READING</div>
        <h2>{doc.title}</h2>
        <p className="dh-author">{doc.author}{doc.current_chapter_title ? ` · ${doc.current_chapter_title}` : ''}</p>
        <div className="progress-row"><ProgressBar value={doc.progress} /><span>{Math.round(doc.progress)}% · {doc.minutes_left} min left</span></div>
        <div className="dh-buttons">
          <button className="resume-btn" onClick={(e) => { e.stopPropagation(); open(); }}>Resume reading <ArrowRight size={15} /></button>
          {audio && <button className="dh-ghost" onClick={(e) => { e.stopPropagation(); navigate(`/audio?book=${audio.id}`); }}><Headphones size={15} /> Resume “{audio.title}”</button>}
        </div>
        <small className="dh-opened"><Clock3 size={12} /> Opened {timeAgo(doc.last_opened_at)} · {doc.last_mode} mode</small>
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
    <div className="page-shell home-page dh">
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

      {docs.loading && !docs.data ? (
        <section className="hero-grid"><Skeleton h={260} r={14} /><Skeleton h={260} r={14} /></section>
      ) : list.length === 0 && !docs.error ? (
        <EmptyState icon={BookOpen} title="Your next reading experience starts here."
          description="Upload a PDF, EPUB, DOCX or text file — ReadVibe splits it into chapters and unlocks AI tools, audio and immersive modes."
          action="Upload a document" onAction={() => setUploadOpen(true)} />
      ) : (
        <>
          <section className="dh-hero">
            {current ? <DeskHero doc={current} audio={lastBook} /> : <Skeleton h={300} r={20} />}
            {stats.data ? <StatsCard stats={stats.data} /> : <Skeleton h={300} r={20} />}
          </section>

          <nav className="dh-actions" aria-label="Quick actions">
            {actions.map(({ label, detail, icon: Icon, tone, run }) => (
              <button key={label} className="action-card" onClick={run}>
                <span className={`action-icon ${tone}`}><Icon size={19} /></span>
                <span className="action-text"><strong>{label}</strong><small>{detail}</small></span>
              </button>
            ))}
          </nav>

          {(recs.data?.length > 0) && (
            <div className="dh-suggest" aria-label="Suggested for you">
              <span className="eyebrow">SUGGESTED FOR YOU</span>
              {recs.data.slice(0, 4).map((r) => {
                const Icon = REC_ICONS[r.action] || WandSparkles;
                return <button key={`${r.action}-${r.document_id}`} onClick={() => runRec(r)}><Icon size={14} /> {r.label}</button>;
              })}
            </div>
          )}

          <HomeShelves docs={list} books={books.data} />

          <section className="dh-widgets">
            <BriefingCard />
            <GoalsCard />
          </section>
        </>
      )}
    </div>
  );
}
