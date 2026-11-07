// Phone Today. Top to bottom: what to pick up (reading · listening · this week), quick actions, then shelves — your books,
// today's briefing, your audiobooks, topics, recently added — and finally what is new in Discover (books, audiobooks, podcasts).
// Each kind of item has its own tile shape and shows its own cover (see HomeTiles).
import React from 'react';
import { Brain, Compass, Flame, Headphones, Play, Search, Sparkles, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { greeting, initials } from '../../lib/format';
import AlbumArt from '../audio/AlbumArt';
import BriefingCard from '../agent/BriefingCard';
import { BookCover } from './HomeTiles';
import HomeShelves from './HomeShelves';

export default function MobileHome({ docs, books, stats, current }) {
  const { user, setUploadOpen, openAI, setSearchOpen } = useApp();
  const navigate = useNavigate();
  const audio = (books || []).filter((b) => b.status === 'ready');
  const resume = audio.find((b) => b.progress > 0 && b.progress < 100);
  const first = (user?.name || '').split(' ')[0];
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

      {/* 3 · shelves (the briefing sits after the first two) */}
      <HomeShelves docs={docs} books={books} middle={<div className="am-brief"><BriefingCard compact /></div>} />
    </div>
  );
}
