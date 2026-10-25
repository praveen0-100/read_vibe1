// Phone Today: greeting, swipeable "pick up" cards, an insight banner, topic chips and a trending list.
import React from 'react';
import { Brain, Search, Clock, Flame, Headphones, Hash, Play, Sparkles, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { greeting, initials } from '../../lib/format';
import { Cover } from '../ui';

const TOPIC_TINTS = ['coral', 'violet', 'blue', 'green', 'amber', 'rose'];

function Art({ doc }) {
  return <div className={`am-art cover-${doc.color || 'coral'}`}><Cover doc={doc} size="sm" /></div>;
}

function Section({ title, onMore, children }) {
  return (
    <section className="am-shelf">
      <h2>{title}{onMore && <button onClick={onMore} aria-label={`See all: ${title}`}>See all</button>}</h2>
      {children}
    </section>
  );
}

export default function MobileHome({ docs, books, stats, current }) {
  const { user, setUploadOpen, openAI, setSearchOpen } = useApp();
  const navigate = useNavigate();
  const ready = docs.filter((d) => d.status === 'ready');
  const played = ready.filter((d) => d.last_opened_at);
  const added = [...ready].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10);
  const resume = (books || []).find((b) => b.status === 'ready' && b.progress > 0 && b.progress < 100);
  const topics = [...new Set(ready.flatMap((d) => d.tags || []))].slice(0, 9);
  const first = (user?.name || '').split(' ')[0];

  return (
    <div className="page-shell home-page am-home">
      <header className="am-title">
        <div>
          <small>{greeting()}{first ? `, ${first}` : ''}</small>
          <h1>Today</h1>
        </div>
        <button className="am-search-btn" onClick={() => setSearchOpen(true)} aria-label="Search"><Search size={20} /></button>
        <button className="mobile-avatar" onClick={() => navigate('/settings')} aria-label="Profile and settings">
          {user?.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(user?.name)}
        </button>
      </header>

      <div className="am-row am-pickrow">
        {current && (
          <button className="am-pick am-pick-tall" onClick={() => navigate(`/read/${current.id}`)}>
            <Art doc={current} />
            <strong>{current.title}</strong>
            <span className="am-meta"><Clock size={14} /> {current.minutes_left}m left</span>
            <span className="am-chip-btn"><Play size={13} fill="currentColor" /> Continue</span>
          </button>
        )}
        {resume && (
          <button className="am-pick am-pick-tall am-pick-blue" onClick={() => navigate(`/audio?book=${resume.id}`)}>
            <span className="am-pick-icon"><Headphones size={40} /></span>
            <strong>{resume.title}</strong>
            <span className="am-meta"><Headphones size={14} /> {Math.round(resume.progress)}% done</span>
            <span className="am-chip-btn"><Play size={13} fill="currentColor" /> Resume</span>
          </button>
        )}
        {stats && (
          <button className="am-pick am-pick-tall am-pick-red" onClick={() => navigate('/read')}>
            <span className="am-pick-icon"><Flame size={40} /></span>
            <strong>{stats.week_minutes} min this week</strong>
            <span className="am-meta">{stats.streak ? `${stats.streak}-day streak` : 'Start a streak today'}</span>
          </button>
        )}
      </div>

      <button className="am-banner" onClick={() => openAI()}>
        <span><strong>Read smarter with AI</strong><small>Summaries, chat, mind maps &amp; more</small></span>
        <Sparkles size={34} aria-hidden="true" />
      </button>

      <Section title="Browse by topics">
        <div className="am-topics">
          {topics.map((t, i) => (
            <button key={t} className={`am-topic tint-${TOPIC_TINTS[i % TOPIC_TINTS.length]}`} onClick={() => navigate(`/library?tag=${encodeURIComponent(t)}`)}>
              <Hash size={16} /> {t}
            </button>
          ))}
          <button className="am-topic tint-coral" onClick={() => setUploadOpen(true)}><Upload size={16} /> Upload a document</button>
          <button className="am-topic tint-green" onClick={() => navigate('/research')}><Brain size={16} /> Start research</button>
        </div>
      </Section>

      {played.length > 0 && (
        <Section title="Recently read" onMore={() => navigate('/library')}>
          <div className="am-row">
            {played.slice(0, 10).map((d) => (
              <button key={d.id} className="am-tile" onClick={() => navigate(`/read/${d.id}`)}>
                <Art doc={d} />
                <strong>{d.title}</strong>
                <small>{d.author} · {Math.round(d.progress)}%</small>
              </button>
            ))}
          </div>
        </Section>
      )}

      {added.length > 0 && (
        <Section title="Recently added" onMore={() => navigate('/library')}>
          <div className="am-list">
            {added.slice(0, 6).map((d) => (
              <button key={d.id} className="am-item" onClick={() => navigate(`/read/${d.id}`)}>
                <Art doc={d} />
                <span className="am-item-text">
                  <strong>{d.title}</strong>
                  <small>{d.author}</small>
                  <span className="am-chip-btn sm"><Play size={11} fill="currentColor" /> Read · {d.minutes_total || '—'}m</span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {(books || []).some((b) => b.status === 'ready') && (
        <Section title="Audiobooks" onMore={() => navigate('/audio')}>
          <div className="am-row">
            {books.filter((b) => b.status === 'ready').map((b) => (
              <button key={b.id} className="am-tile" onClick={() => navigate(`/audio?book=${b.id}`)}>
                <div className={`am-art cover-${b.color || 'blue'}`}><span className="am-play"><Play size={22} fill="currentColor" /></span></div>
                <strong>{b.title}</strong>
                <small>{b.tone || 'Audiobook'}</small>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
