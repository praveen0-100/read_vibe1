// Phone Today. Top to bottom: what to pick up (reading · listening · this week), quick actions, then shelves — your books,
// today's briefing, your audiobooks, topics, recently added — and finally what is new in Discover (books, audiobooks, podcasts).
// Each kind of item has its own tile shape and shows its own cover (see HomeTiles).
import React from 'react';
import { Brain, Compass, Flame, Headphones, Play, Search, Sparkles, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { fetchFresh } from '../../lib/catalog';
import { greeting, initials } from '../../lib/format';
import AlbumArt from '../audio/AlbumArt';
import BriefingCard from '../agent/BriefingCard';
import { AudioTile, BookCover, BookTile, DiscoverTile, TileSkeletons } from './HomeTiles';

const TOPIC_TINTS = ['coral', 'violet', 'blue', 'green', 'amber', 'rose'];

function Section({ title, hint, onMore, children, className = '' }) {
  return (
    <section className={`am-shelf ${className}`}>
      <header className="am-shelf-head">
        <h2>{title}{hint && <small>{hint}</small>}</h2>
        {onMore && <button onClick={onMore} aria-label={`See all: ${title}`}>See all</button>}
      </header>
      {children}
    </section>
  );
}

export default function MobileHome({ docs, books, stats, current }) {
  const { user, setUploadOpen, openAI, setSearchOpen } = useApp();
  const navigate = useNavigate();
  const ready = docs.filter((d) => d.status === 'ready');
  const played = ready.filter((d) => d.last_opened_at);
  const added = [...ready].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 5);
  const audio = (books || []).filter((b) => b.status === 'ready');
  const resume = audio.find((b) => b.progress > 0 && b.progress < 100);
  const topics = [...new Set(ready.flatMap((d) => d.tags || []))].slice(0, 10);
  const first = (user?.name || '').split(' ')[0];
  // what is new in the free catalogues; quietly absent when offline
  const fresh = useQuery(() => fetchFresh(), []);
  const discover = fresh.data;
  const open = (path) => () => navigate(path);

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

      {/* 1 · pick up where you left off */}
      {(current || resume || stats) && (
        <div className="am-hero-wrap">
          {current && (
            <button className="am-hero" onClick={open(`/read/${current.id}`)}>
              <span className="am-hero-cover"><BookCover doc={current} /></span>
              <span className="am-hero-text">
                <small>Continue reading</small>
                <strong>{current.title}</strong>
                <em>{current.author}</em>
                <span className="am-hero-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(current.progress || 0))}%` }} /></span>
                <span className="am-hero-meta">{Math.round(current.progress || 0)}% · {current.minutes_left}m left</span>
                <span className="am-chip-btn"><Play size={13} fill="currentColor" /> Continue</span>
              </span>
            </button>
          )}
          {(resume || stats) && (
            <div className="am-duo">
              {resume && (
                <button className="am-mini am-mini-audio" onClick={open(`/audio?book=${resume.id}`)}>
                  <span className="am-mini-art"><AlbumArt title={resume.title} color={resume.color || 'blue'} cover={resume.cover ?? (resume.document_has_cover ? resume.document_id : null)} size="tile" bare /></span>
                  <small><Headphones size={12} /> Resume listening</small>
                  <strong>{resume.title}</strong>
                  <span className="am-hero-meta">{Math.round(resume.progress)}% done</span>
                </button>
              )}
              {stats && (
                <button className="am-mini am-mini-week" onClick={open('/read')}>
                  <Flame size={26} aria-hidden="true" />
                  <small>This week</small>
                  <strong>{stats.week_minutes} min</strong>
                  <span className="am-hero-meta">{stats.streak ? `${stats.streak}-day streak` : 'Start a streak today'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2 · quick actions */}
      <nav className="am-actions" aria-label="Quick actions">
        <button onClick={() => openAI()}><Sparkles size={20} /><span>Ask AI</span></button>
        <button onClick={() => navigate('/research')}><Brain size={20} /><span>Research</span></button>
        <button onClick={() => setUploadOpen(true)}><Upload size={20} /><span>Upload</span></button>
        <button onClick={() => navigate('/discover')}><Compass size={20} /><span>Discover</span></button>
      </nav>

      {/* 4 · your shelves */}
      {played.length > 0 && (
        <Section title="Recently read" onMore={open('/library')}>
          <div className="am-row">{played.slice(0, 10).map((d) => <BookTile key={d.id} doc={d} onOpen={open(`/read/${d.id}`)} />)}</div>
        </Section>
      )}

      <div className="am-brief"><BriefingCard compact /></div>

      {audio.length > 0 && (
        <Section title="Audiobooks" onMore={open('/audio')}>
          <div className="am-row">{audio.slice(0, 12).map((b) => <AudioTile key={b.id} book={b} onOpen={open(`/audio?book=${b.id}`)} />)}</div>
        </Section>
      )}

      {topics.length > 0 && (
        <Section title="Browse by topic">
          <div className="am-row am-topic-row">
            {topics.map((t, i) => (
              <button key={t} className={`am-topic tint-${TOPIC_TINTS[i % TOPIC_TINTS.length]}`} onClick={open(`/library?tag=${encodeURIComponent(t)}`)}>{t}</button>
            ))}
          </div>
        </Section>
      )}

      {added.length > 0 && (
        <Section title="Recently added" onMore={open('/library')}>
          <div className="am-list">
            {added.map((d) => (
              <button key={d.id} className="am-item" onClick={open(`/read/${d.id}`)}>
                <span className="am-item-cover"><BookCover doc={d} /></span>
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

      {/* 5 · new in Discover */}
      {(fresh.loading && !discover) && (
        <Section title="New in Discover"><div className="am-row"><TileSkeletons kind="ebook" n={4} /></div></Section>
      )}
      {discover?.ebooks?.length > 0 && (
        <Section title="New free books" hint="Project Gutenberg" onMore={open('/discover')}>
          <div className="am-row">{discover.ebooks.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="ebook" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
      {discover?.audiobooks?.length > 0 && (
        <Section title="New audiobooks" hint="LibriVox" onMore={open('/discover')}>
          <div className="am-row">{discover.audiobooks.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="audio" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
      {discover?.podcasts?.length > 0 && (
        <Section title="Popular podcasts" onMore={open('/discover')}>
          <div className="am-row">{discover.podcasts.slice(0, 12).map((it) => <DiscoverTile key={it.id} item={it} kind="podcast" onOpen={open('/discover')} />)}</div>
        </Section>
      )}
    </div>
  );
}
