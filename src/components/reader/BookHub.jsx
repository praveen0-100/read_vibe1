// One place, inside the book, for everything ReadVibe can do with it — no hunting through other modules.
// Each action works on the open book (and chapter) directly; existing audiobooks and decks are reused, not duplicated.
import React from 'react';
import {
  AudioLines, BookOpen, CircleHelp, CloudDownload, Headphones, Library, Mic2, Moon, Network, Pause, Play, Presentation,
  Sparkles, StickyNote, Telescope, Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useQuery } from '../../hooks/useAsync';
import { Modal } from '../ui';

function Tile({ icon: Icon, title, hint, onClick, disabled, on, badge }) {
  return (
    <button type="button" className={`hub-tile ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="hub-ico"><Icon size={18} /></span>
      <span className="hub-txt"><b>{title}</b><small>{hint}</small></span>
      {badge && <em>{badge}</em>}
    </button>
  );
}

export default function BookHub({
  open, onClose, doc, chapterIndex, mode, setMode, listen, narrator, startListening, onOverview, openAI, saveOffline, offlineMode,
}) {
  const navigate = useNavigate();
  const books = useQuery(() => (open ? api.audio.list() : Promise.resolve([])), [open, doc.id]);
  const decks = useQuery(() => (open ? api.decks.list() : Promise.resolve([])), [open, doc.id]);
  const book = (books.data || []).find((b) => b.document_id === doc.id && b.status === 'ready');
  const bookBusy = (books.data || []).find((b) => b.document_id === doc.id && b.status !== 'ready' && b.status !== 'failed');
  const deck = (decks.data || []).find((d) => d.document_id === doc.id && d.status === 'ready');

  const go = (fn) => () => { onClose(); fn(); };
  const ai = (tool) => go(() => openAI({ documentId: doc.id, chapterIndex, tool, tab: tool ? 'tools' : 'chat', nonce: Date.now() }));

  return (
    <Modal open={open} onClose={onClose} eyebrow="THIS BOOK" title={doc.title} icon={Library} size="lg" className="book-hub">
      <section aria-label="Listen">
        <h4 className="hub-h">Listen</h4>
        <div className="hub-grid">
          <Tile icon={listen.playing ? Pause : Play} on={listen.playing} title={listen.playing ? 'Pause reading aloud' : 'Read aloud from here'}
            hint="Follows the page, word by word" onClick={go(() => (listen.playing ? narrator.pause() : startListening()))} />
          {book
            ? <Tile icon={Headphones} title="Play audiobook" hint="Already narrated — continue where you left off" onClick={go(() => navigate(`/audio?book=${book.id}`))} />
            : <Tile icon={Headphones} title={bookBusy ? 'Audiobook is being prepared' : 'Create audiobook'} hint={bookBusy ? 'Open the studio to follow progress' : 'Humor, tough or regular narration'}
              onClick={go(() => navigate(bookBusy ? '/audio?tab=saved' : `/audio?tab=generate&doc=${doc.id}`))} />}
          <Tile icon={Mic2} title="Podcast / audio overview" hint="Two hosts discuss it, in any language" onClick={go(() => onOverview?.())} />
        </div>
      </section>

      <section aria-label="Reading mode">
        <h4 className="hub-h">Reading mode</h4>
        <div className="hub-grid">
          <Tile icon={BookOpen} on={mode === 'Reader'} title="Reader" hint="Clean page, highlights, notes" onClick={go(() => setMode('Reader'))} />
          <Tile icon={Moon} on={mode === 'Zen'} title="Zen" hint="Ambient scenes and a focus timer" onClick={go(() => setMode('Zen'))} />
          <Tile icon={AudioLines} on={mode === 'Vibe'} title="Vibe" hint="Music that matches the mood" onClick={go(() => setMode('Vibe'))} />
        </div>
      </section>

      <section aria-label="Understand">
        <h4 className="hub-h">Understand</h4>
        <div className="hub-grid">
          <Tile icon={Sparkles} title="Summarize this section" hint="Key ideas in seconds" onClick={ai('summarize')} />
          <Tile icon={Network} title="Mind map" hint="See how the ideas connect" onClick={ai('mindmap')} />
          <Tile icon={CircleHelp} title="Quiz me" hint="Test what you just read" onClick={ai('quiz')} />
          <Tile icon={Wand2} title="Ask anything" hint="Chat with the book" onClick={ai(null)} />
        </div>
      </section>

      <section aria-label="Create and keep">
        <h4 className="hub-h">Create &amp; keep</h4>
        <div className="hub-grid">
          {deck
            ? <Tile icon={Presentation} title="Open presentation" hint="Your slides for this book" onClick={go(() => navigate(`/decks/${deck.id}`))} />
            : <Tile icon={Presentation} title="Make a presentation" hint="Animated slides with presenter view" onClick={go(() => navigate(`/decks?doc=${doc.id}`))} />}
          <Tile icon={StickyNote} title="Notebook" hint="Your highlights and notes" onClick={go(() => navigate(`/notes?doc=${doc.id}`))} />
          <Tile icon={Telescope} title="Research" hint="Use it as a source in a project" onClick={go(() => navigate('/research'))} />
          <Tile icon={CloudDownload} title="Save offline" hint={offlineMode ? 'You are reading an offline copy' : 'Read without a connection'} disabled={offlineMode} onClick={go(saveOffline)} />
        </div>
      </section>
    </Modal>
  );
}
