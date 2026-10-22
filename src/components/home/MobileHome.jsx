// Phone Home: large title, then swipeable shelves — "Top Picks for You", "Recently Played", "Recently Added", "Audiobooks".
import React from 'react';
import { ChevronRight, Flame, Headphones, Play, Sparkles, Upload, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { initials } from '../../lib/format';
import { Cover } from '../ui';

function Shelf({ title, onMore, children }) {
  return (
    <section className="am-shelf">
      <h2>{onMore ? <button onClick={onMore}>{title} <ChevronRight size={20} strokeWidth={3} /></button> : title}</h2>
      <div className="am-row">{children}</div>
    </section>
  );
}

function Art({ doc }) {
  return <div className={`am-art cover-${doc.color || 'coral'}`}><Cover doc={doc} size="sm" /></div>;
}

function Tile({ doc, onOpen, sub }) {
  return (
    <button className="am-tile" onClick={onOpen} disabled={doc.status && doc.status !== 'ready'}>
      <Art doc={doc} />
      <strong>{doc.title}</strong>
      <small>{sub || doc.author}</small>
    </button>
  );
}

export default function MobileHome({ docs, books, stats, current }) {
  const { user, setUploadOpen, openAI } = useApp();
  const navigate = useNavigate();
  const ready = docs.filter((d) => d.status === 'ready');
  const played = ready.filter((d) => d.last_opened_at);
  const added = [...ready].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10);
  const resume = (books || []).find((b) => b.status === 'ready' && b.progress > 0 && b.progress < 100);
  const audiobooks = (books || []).filter((b) => b.status === 'ready');

  return (
    <div className="page-shell home-page am-home">
      <header className="am-title">
        <h1>Home</h1>
        <button className="mobile-avatar" onClick={() => navigate('/settings')} aria-label="Profile and settings">
          {user?.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(user?.name)}
        </button>
      </header>

      <Shelf title="Top Picks for You">
        {current && (
          <button className="am-pick am-pick-tall" onClick={() => navigate(`/read/${current.id}`)}>
            <Art doc={current} />
            <span className="am-kicker">Continue Reading</span>
            <strong>{current.title}</strong>
            <small>{Math.round(current.progress)}% · {current.minutes_left} min left</small>
          </button>
        )}
        {resume && (
          <button className="am-pick am-pick-tall am-pick-blue" onClick={() => navigate(`/audio?book=${resume.id}`)}>
            <span className="am-pick-icon"><Headphones size={44} /></span>
            <span className="am-kicker">Resume Listening</span>
            <strong>{resume.title}</strong>
            <small>{Math.round(resume.progress)}% done</small>
          </button>
        )}
        {stats && (
          <button className="am-pick am-pick-tall am-pick-red" onClick={() => navigate('/read')}>
            <span className="am-pick-icon"><Flame size={44} /></span>
            <span className="am-kicker">Made for You</span>
            <strong>{stats.week_minutes} min this week</strong>
            <small>{stats.streak ? `${stats.streak}-day streak` : 'Start a streak today'}</small>
          </button>
        )}
        <button className="am-pick am-pick-short am-pick-violet" onClick={() => openAI()}><Sparkles size={26} /><strong>Read with AI</strong><small>Summaries, chat, mind maps</small></button>
        <button className="am-pick am-pick-short am-pick-coral" onClick={() => setUploadOpen(true)}><Upload size={26} /><strong>Upload a document</strong><small>PDF, EPUB, DOCX, TXT</small></button>
        <button className="am-pick am-pick-short am-pick-green" onClick={() => navigate('/research')}><Brain size={26} /><strong>Start research</strong><small>From topic to cited draft</small></button>
      </Shelf>

      {played.length > 0 && (
        <Shelf title="Recently Read" onMore={() => navigate('/library')}>
          {played.slice(0, 10).map((d) => <Tile key={d.id} doc={d} onOpen={() => navigate(`/read/${d.id}`)} sub={`${d.author} · ${Math.round(d.progress)}%`} />)}
        </Shelf>
      )}

      {added.length > 0 && (
        <Shelf title="Recently Added" onMore={() => navigate('/library')}>
          {added.map((d) => <Tile key={d.id} doc={d} onOpen={() => navigate(`/read/${d.id}`)} />)}
        </Shelf>
      )}

      {audiobooks.length > 0 && (
        <Shelf title="Audiobooks" onMore={() => navigate('/audio')}>
          {audiobooks.map((b) => (
            <button key={b.id} className="am-tile" onClick={() => navigate(`/audio?book=${b.id}`)}>
              <div className={`am-art cover-${b.color || 'blue'}`}><span className="am-play"><Play size={22} fill="currentColor" /></span></div>
              <strong>{b.title}</strong>
              <small>{b.tone || 'Audiobook'}</small>
            </button>
          ))}
        </Shelf>
      )}
    </div>
  );
}
