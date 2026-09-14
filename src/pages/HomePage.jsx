// ─── Home Page ────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  ArrowRight, Upload, Sparkles, Headphones, Brain, Flame, Clock3,
  MoreHorizontal, WandSparkles, BookOpen, Zap, Play
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SectionHead, ProgressBar } from '../components/ui';
import { READING_STATS, AI_SUGGESTIONS } from '../data/mockData';

function BookCover({ doc }) {
  const colors = {
    coral: '#c96a52',
    blue: '#5a7a9e',
    lavender: '#8a7ab8',
    amber: '#b88548',
  };
  return (
    <div className={`book-cover cover-${doc.color}`} style={{ background: colors[doc.color] }}>
      <div className="cover-symbol">{doc.coverSymbol}</div>
      <small>{doc.title.toUpperCase().substring(0, 20)}</small>
      <b>{doc.author.toUpperCase().split(' ').slice(-1)[0]}</b>
    </div>
  );
}

function ContinueCard({ doc, onOpen }) {
  return (
    <div className="continue-card" onClick={() => onOpen(doc)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(doc)}>
      <div className="card-kicker">
        <span className="pulse" aria-hidden="true" />
        CONTINUE READING
        <span className="kicker-progress">{doc.progress}%</span>
      </div>
      <div className="continue-content">
        <BookCover doc={doc} />
        <div className="continue-copy">
          <h2>{doc.title}</h2>
          <p>{doc.author}</p>
          <div className="progress-row">
            <ProgressBar value={doc.progress} />
            <span>p. {doc.currentPage} / {doc.totalPages}</span>
          </div>
          <button className="resume-btn" onClick={(e) => { e.stopPropagation(); onOpen(doc); }}>
            Resume reading <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <div className="continue-footer">
        <span><Clock3 size={13} /> {doc.time}</span>
        <span className="mode-pill">Reader mode</span>
      </div>
    </div>
  );
}

function StatsCard() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const max = Math.max(...READING_STATS.weeklyMinutes);
  return (
    <div className="stats-card">
      <div className="section-top">
        <span className="eyebrow">YOUR READING RHYTHM</span>
        <MoreHorizontal size={17} />
      </div>
      <div className="focus-number">
        {READING_STATS.currentWeekTotal} <small>min</small>
      </div>
      <p className="stats-sub">focus time this week</p>
      <div className="bars" aria-label="Weekly reading chart">
        {READING_STATS.weeklyMinutes.map((h, i) => (
          <div
            key={i}
            className={`bar ${i === 5 ? 'today' : ''}`}
            style={{ height: `${(h / max) * 100}%` }}
            title={`${days[i]}: ${h} min`}
          >
            <span>{days[i]}</span>
          </div>
        ))}
      </div>
      <div className="streak-row">
        <Flame size={15} />
        <span>{READING_STATS.streak} day reading streak</span>
        <ArrowRight size={13} />
      </div>
    </div>
  );
}

function QuickActions({ setPage, notify }) {
  const actions = [
    { label: 'Upload document', detail: 'PDF, EPUB, DOCX or TXT', icon: Upload, tone: 'coral', page: null, action: () => notify('Open the upload dialog to add documents') },
    { label: 'Summarize a chapter', detail: 'Get the signal, skip the noise', icon: Sparkles, tone: 'violet', page: 'reader' },
    { label: 'Generate audiobook', detail: 'Listen in your favorite tone', icon: Headphones, tone: 'blue', page: 'audio' },
    { label: 'Start research', detail: 'Turn a question into a paper', icon: Brain, tone: 'green', page: 'research' },
  ];

  return (
    <section className="section-block">
      <SectionHead eyebrow="MAKE IT YOURS" title="What would you like to do?" />
      <div className="action-grid">
        {actions.map(({ label, detail, icon: Icon, tone, page, action }) => (
          <button
            key={label}
            className="action-card"
            onClick={() => page ? setPage(page) : action?.()}
          >
            <div className={`action-icon ${tone}`}>
              <Icon size={20} />
            </div>
            <div className="action-text">
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
            <ArrowRight size={15} className="action-arrow" />
          </button>
        ))}
      </div>
    </section>
  );
}

function DocumentMiniCard({ doc, openDoc }) {
  return (
    <button className="doc-card" onClick={() => openDoc(doc)}>
      <div className={`mini-cover cover-${doc.color}`}>
        <span>{doc.coverSymbol}</span>
      </div>
      <div className="doc-info">
        <div className="doc-type">{doc.type} · {doc.tag}</div>
        <h3>{doc.title}</h3>
        <p>{doc.author}</p>
        <ProgressBar value={doc.progress} thin className="doc-progress" />
        <small>{doc.progress}% complete</small>
      </div>
      <MoreHorizontal size={15} className="doc-more" />
    </button>
  );
}

function AISuggestionBanner({ setPage, notify }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section className="suggestion-banner">
      <div className="suggestion-icon"><WandSparkles size={19} /></div>
      <div className="suggestion-body">
        <div className="eyebrow">A NOTE FROM READVIBE</div>
        <p>"You highlighted 7 concepts in <em>Design of Everyday Things</em>. Want me to connect them into a mind map?"</p>
      </div>
      <div className="suggestion-actions">
        <button className="small-button" onClick={() => { setPage('reader'); notify('Mind map queued for generation'); }}>
          Create mind map
        </button>
        <button className="dismiss-btn" onClick={() => setDismissed(true)} aria-label="Dismiss suggestion">×</button>
      </div>
    </section>
  );
}

function MiniStatsRow() {
  return (
    <div className="mini-stats-row">
      {[
        { label: 'Books read', value: READING_STATS.totalBooksRead, icon: BookOpen },
        { label: 'Audio hours', value: READING_STATS.totalAudioHours + 'h', icon: Headphones },
        { label: 'Focus sessions', value: READING_STATS.focusSessions, icon: Zap },
      ].map(({ label, value, icon: Icon }) => (
        <div key={label} className="mini-stat">
          <Icon size={16} />
          <div>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { state, openDoc, setPage, notify } = useApp();
  const { documents } = state;

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page-shell home-page">
      {/* Topbar */}
      <header className="topbar">
        <div>
          <div className="eyebrow">{date}</div>
          <h1>{greeting}, Praveen.</h1>
        </div>
        <div className="top-actions">
          <MiniStatsRow />
        </div>
      </header>

      {/* Hero Grid: Continue Reading + Stats */}
      <section className="hero-grid">
        <ContinueCard doc={documents[0]} onOpen={openDoc} />
        <StatsCard />
      </section>

      {/* Quick Actions */}
      <QuickActions setPage={setPage} notify={notify} />

      {/* Recent Library */}
      <section className="section-block">
        <SectionHead
          eyebrow="FROM YOUR LIBRARY"
          title="Pick up where you left off"
          actionLabel="View library"
          onAction={() => setPage('library')}
        />
        <div className="document-row">
          {documents.slice(1, 4).map(doc => (
            <DocumentMiniCard key={doc.id} doc={doc} openDoc={openDoc} />
          ))}
        </div>
      </section>

      {/* AI Suggestion Banner */}
      <AISuggestionBanner setPage={setPage} notify={notify} />
    </div>
  );
}
